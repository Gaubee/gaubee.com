//! gaubee.com 静态站服务（axum + tower-http，2026-08-15）+ cdn-base
//!（cdn-media-bootstrap plan Phase 1，2026-10-06）。
//!
//! 正交意图：
//! 1. 原始需求（2026-08-15）：nginx 容器 → Rust 自研静态服务，
//!    musl 静态二进制 + scratch 镜像（~15MB 级，nginx:alpine 的三分之一）。
//!    Pingora 是代理/LB 框架、无静态文件模块，故选 axum + tower-http 标准生态。
//! 2. 查找语义与退役的 deploy/nginx.conf 逐条对齐（四级 try_files）：
//!    `$uri` / `$uri/index.html`（ServeDir 内置）→ `$uri.html`（扁平 SSG，fallback 阶段一）
//!    → `/index.html`（SPA fallback，阶段二；未知路径由 SPA 渲染 NotFound）。
//! 3. 缓存矩阵（Router::layer 覆盖所有路由含 fallback）：默认 no-cache
//!    （协商缓存，发布即时生效）；`/_app/immutable/*`（vite 内容哈希资产）一年 immutable。
//! 4. MIME 修正：`.md` 显式 text/markdown（raw markdown 端点）。
//! 5. cdn-base（R3/R4）：`/cdn-media/:source/*` 独立子路由——挂在无中间件的外层
//!    Router，结构性绕过全局 CompressionLayer 与通用 no-cache 头（A4）；
//!    admin listener 0.0.0.0:8081（A5，compose 只发布宿主 loopback），8080 上
//!    admin 路径显式 404；配置缺失/非法或启动强校验不过 → 启动即败（A9）。
//!
//! 容器内明文 8080/8081（非 root 可绑），TLS 由服务器外层反代负责。

mod admin;
mod cache;
mod config;
mod manifest;
mod media;
/// USTAR 头解析（A1）：运行时不解卷（对象按 manifest offset 直取 HTTP Range），
/// 仅测试用本地 staging 卷核对 offset 定位语义
#[cfg(test)]
mod ustar;
/// 测试专用支撑：本地 raw mock 上游 + 测试 Config（仅测试构建编译）
#[cfg(test)]
mod test_support;

use std::collections::HashSet;
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::http::{header, HeaderValue, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::Router;
use tower::ServiceExt;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    runtime.block_on(run());
}

/// 主端口解析（r6 P1-2）：PORT=0 与非法值一律拒绝——compose 将宿主端口映射到
/// 容器固定 8080，绑随机端口会使容器端口不可达（健康检查与站点直接失效）。
/// 缺失/空白 = 默认 8080
fn parse_port(raw: Option<String>) -> Result<u16, String> {
    let Some(v) = raw else { return Ok(8080) };
    let cleaned = v.trim();
    if cleaned.is_empty() {
        return Ok(8080);
    }
    let p: u16 = cleaned
        .parse()
        .map_err(|_| format!("PORT={v:?} 解析失败。修复：PORT 必须是 1-65535 的整数"))?;
    if p == 0 {
        return Err("PORT=0 非法（修复：改为有效监听端口，如 8080）".to_owned());
    }
    Ok(p)
}

async fn run() {
    // 1. 配置加载（A9：文件缺失/字段非法 → 启动即败，日志给修复指令）
    let cfg = match config::load(&config::ProcessEnv) {
        Ok(c) => Arc::new(c),
        Err(e) => {
            eprintln!("[cdn-base] 配置错误，启动即败：{e}");
            std::process::exit(1);
        }
    };
    let root = PathBuf::from(env::var("SERVER_ROOT").unwrap_or_else(|_| "/srv".into()));
    // r5 P1-14 / r6 P1-2：env 解析失败与 PORT=0 一律启动即败，绝不静默回退
    let port = match parse_port(env::var("PORT").ok()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[cdn-base] {e}，启动即败");
            std::process::exit(1);
        }
    };

    // 2. 缓存恢复 + 磁盘启动强校验（A3：可写探针 / 剩余空间 ≥ high×1.2 / 水位合法）
    let pinned: HashSet<String> = cfg.pinned.keys.iter().cloned().collect();
    let cache: Arc<cache::DiskCache> = match startup_cache_validation(&cfg, &pinned) {
        Ok(c) => Arc::new(c),
        Err(e) => {
            eprintln!("[cdn-base] 缓存目录校验失败，启动即败：{e}");
            std::process::exit(1);
        }
    };

    // 3. manifest 首次加载（A2：重试 4 次、退避 3/6/12/24s）。
    //    失败时：配置了 pinned → 无法核对预算，启动即败；否则降级继续
    //    （冷启动无 LKG：source 视为不可用 503，服务本体照常起）。
    let manifest = Arc::new(manifest::ManifestSource::new(cfg.clone()));
    match manifest.refresh().await {
        Ok(idx) => {
            if let Err(e) = check_pinned_budget(&cfg, &idx) {
                eprintln!("[cdn-base] pinned 预算校验失败，启动即败：{e}");
                std::process::exit(1);
            }
        }
        Err(e) => {
            if !pinned.is_empty() {
                eprintln!(
                    "[cdn-base] manifest 不可用（{e}）且配置了 pinned，无法核对预算，启动即败。\
                     修复：恢复 GitHub 可达后重试，或清空 pinned.keys"
                );
                std::process::exit(1);
            }
            eprintln!("[cdn-base] manifest 首次加载失败（{e}），降级启动：/cdn-media 返回 503");
        }
    }

    // 4. 路由结构（A4 middleware 隔离）：
    //    内层 main_app 逐字节保留原 8080 语义（healthz + 静态 + 压缩 + 缓存矩阵）；
    //    外层只挂 media 子路由（无任何中间件 → 天然无压缩/无 no-cache）与
    //    admin 路径的显式 404（公网 8080 扫描 /cdn-media-admin/* 必须 404，A5）。
    let root_for_log = root.display().to_string();
    let serve_dir = ServeDir::new(&root)
        .append_index_html_on_directories(false)
        .fallback(tower::service_fn(move |req: Request<axum::body::Body>| {
            fallback(req, root.clone())
        }));

    let main_app: Router = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(serve_dir)
        .layer(middleware::from_fn(cache_and_mime))
        .layer(CompressionLayer::new());

    let media_ctx = Arc::new(media::MediaCtx {
        cfg: cfg.clone(),
        manifest: manifest.clone(),
        cache,
        http: media::MediaCtx::new_client(),
        // r6 P1-3：warm 全局并发闸——跨请求共享（构造即定死上限）
        warm_gate: Arc::new(tokio::sync::Semaphore::new(admin::WARM_CONCURRENCY)),
    });

    let media_router: Router = Router::new()
        .route("/cdn-media/{source}/{*key}", get(media::serve))
        .with_state(media_ctx.clone());

    // Phase 3 兼容路由（A8/R1）：存量 /x-media/* 引用 302 到 /cdn-media/x/*。
    // 挂在无中间件的外层 Router（重定向无需压缩/缓存矩阵）；临时语义——一个版本周期后移除。
    let compat_router: Router = Router::new().route("/x-media/{*rest}", get(media::x_media_compat));

    let admin_block: Router = Router::new()
        .route("/cdn-media-admin", any(admin_not_found))
        .route("/cdn-media-admin/", any(admin_not_found))
        .route("/cdn-media-admin/{*rest}", any(admin_not_found));

    let app: Router = Router::new()
        .merge(media_router)
        .merge(compat_router)
        .merge(admin_block)
        .fallback_service(main_app);

    // admin listener（A5）：8081 独立 Router，无压缩/无缓存矩阵
    let admin_enabled = cfg.admin.enabled;
    let admin_port = cfg.admin.port;
    let admin_app: Router = Router::new()
        .route("/cdn-media-admin/warm", post(admin::warm))
        .route("/cdn-media-admin/stats", get(admin::stats))
        .fallback(admin_not_found)
        .with_state(media_ctx);

    // 5. 双 listener + 后台指针刷新（短 TTL）
    let main_addr = SocketAddr::from(([0, 0, 0, 0], port));
    let admin_addr = SocketAddr::from(([0, 0, 0, 0], admin_port));

    let listener = tokio::net::TcpListener::bind(main_addr)
        .await
        .unwrap_or_else(|e| panic!("bind {main_addr} 失败：{e}"));
    let admin_listener = if admin_enabled {
        Some(
            tokio::net::TcpListener::bind(admin_addr)
                .await
                .unwrap_or_else(|e| panic!("bind {admin_addr} 失败：{e}")),
        )
    } else {
        None
    };
    eprintln!(
        "gaubee-static-server listening on {main_addr}, root={root_for_log}\
        {}, cdn-cache={}",
        if admin_enabled {
            format!(" + admin on {admin_addr}")
        } else {
            String::new()
        },
        cfg.cache.dir
    );

    // 后台刷新：间隔到达时条件拉指针（ETag），成功原子换索引，失败保 LKG
    let manifest_for_refresh = manifest.clone();
    let cfg_for_refresh = cfg.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(manifest_for_refresh.refresh_interval);
        tick.tick().await; // 首个 tick 立即完成（启动时已刷过）
        loop {
            tick.tick().await;
            match manifest_for_refresh.refresh().await {
                Ok(idx) => {
                    // 代际切换后重新核对 pinned 预算（运行期仅告警，不杀服务）
                    if let Err(e) = check_pinned_budget(&cfg_for_refresh, &idx) {
                        eprintln!("[cdn-base] pinned 预算告警（gen 切换后）：{e}");
                    }
                }
                Err(e) => {
                    eprintln!("[cdn-base] manifest 刷新失败（保留 last-known-good）：{e}")
                }
            }
        }
    });

    let main_handle =
        tokio::spawn(async move { axum::serve(listener, app).await.expect("server error") });
    // r5 P1-15：tokio::select! 同时等双 listener——任一结束（含 panic 产生的 JoinError）
    // 即 abort 另一任务并整体退出，不再允许单 listener 孤儿存活
    match admin_listener {
        Some(l) => {
            let mut main_handle = main_handle;
            let mut admin_handle = tokio::spawn(async move {
                axum::serve(l, admin_app).await.expect("admin server error")
            });
            tokio::select! {
                r = &mut main_handle => {
                    eprintln!("[cdn-base] main listener 先行退出（{r:?}）：abort admin 任务并整体退出");
                    admin_handle.abort();
                    std::process::exit(1);
                }
                r = &mut admin_handle => {
                    eprintln!("[cdn-base] admin listener 先行退出（{r:?}）：abort main 任务并整体退出");
                    main_handle.abort();
                    std::process::exit(1);
                }
            }
        }
        None => {
            if main_handle.await.is_err() {
                eprintln!("[cdn-base] main listener 异常退出");
                std::process::exit(1);
            }
        }
    }
}

async fn admin_not_found() -> Response {
    (StatusCode::NOT_FOUND, "not found").into_response()
}

/// A3 启动强校验：可写探针 → 剩余空间 ≥ high×1.2 → 水位合法 → 恢复 LRU
fn startup_cache_validation(
    cfg: &config::Config,
    pinned: &HashSet<String>,
) -> Result<cache::DiskCache, String> {
    let dir = PathBuf::from(&cfg.cache.dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("无法创建缓存目录 {dir:?}：{e}。修复：宿主预创建目录并 chown 65532:65532（A3 bind mount），或修正 cache.dir / env MEDIA_CACHE_DIR"))?;
    let probe = dir.join(".write-probe");
    std::fs::write(&probe, b"probe")
        .map_err(|e| format!("缓存目录 {dir:?} 不可写（UID 65532）：{e}。修复：chown 65532:65532 {dir:?}"))?;
    std::fs::remove_file(&probe)
        .map_err(|e| format!("缓存目录 {dir:?} 探针清理失败：{e}"))?;

    let required = cfg.cache.high_bytes.saturating_mul(12) / 10;
    let free = free_disk_bytes(&dir)?;
    if free < required {
        return Err(format!(
            "剩余空间不足：{dir:?} 可用 {free} 字节 < high×1.2 = {required} 字节。修复：清理磁盘或调低 cache.high_bytes"
        ));
    }
    if cfg.cache.low_bytes >= cfg.cache.high_bytes {
        return Err(format!(
            "水位非法：low({}) ≥ high({})。修复：调整 cache.low_bytes / cache.high_bytes",
            cfg.cache.low_bytes, cfg.cache.high_bytes
        ));
    }
    cache::DiskCache::recover(&dir, cfg.cache.high_bytes, cfg.cache.low_bytes, pinned)
        .map_err(|e| format!("缓存目录恢复失败 {dir:?}：{e}"))
}

/// pinned 预算（R3）：key 必须在 manifest 中；合计 ≤ high_bytes，超出启动失败
fn check_pinned_budget(cfg: &config::Config, idx: &manifest::ManifestIndex) -> Result<(), String> {
    if cfg.pinned.keys.is_empty() {
        return Ok(());
    }
    let mut total = 0u64;
    for k in &cfg.pinned.keys {
        let o = idx.lookup(k).ok_or_else(|| {
            format!("pinned key {k:?} 不在 manifest 中（修复：更正 key 或重新打包发布）")
        })?;
        // r6 P1-8：合计 checked——极端 manifest 数据溢出时启动即败，绝不回绕放行
        total = total.checked_add(o.size).ok_or_else(|| {
            format!("pinned 合计字节溢出（key {k}，size {}）——manifest 数据异常", o.size)
        })?;
    }
    if total > cfg.cache.high_bytes {
        return Err(format!(
            "pinned 合计 {total} 字节 > high {} 字节（修复：缩减 pinned.keys 或调高 cache.high_bytes）",
            cfg.cache.high_bytes
        ));
    }
    Ok(())
}

fn free_disk_bytes(dir: &Path) -> Result<u64, String> {
    let c = std::ffi::CString::new(dir.to_str().ok_or("缓存路径非 UTF-8")?)
        .map_err(|e| format!("路径编码失败：{e}"))?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c.as_ptr(), &mut st) };
    if rc != 0 {
        return Err("statvfs 失败（剩余空间不可测）".to_owned());
    }
    Ok(st.f_bavail as u64 * st.f_frsize as u64)
}

/// nginx try_files 的后三级（`$uri` 精确命中由 ServeDir 完成）：
/// 1. `{path}.html` —— SvelteKit SSG 扁平格式（如 /pages → /pages.html）
/// 2. `{path}/index.html` —— SSG 目录格式（如 /pages/archive/）
/// 3. `{root}/index.html` —— SPA fallback（编辑器等客户端路由）
///
/// 注：`/` 由 ServeDir 的 index 兜不住（append_index 已关），
/// 在此统一按第 2 级（`/` → `//index.html` 归一为 `/index.html`）处理。
async fn fallback(req: Request<axum::body::Body>, root: PathBuf) -> Result<Response, Infallible> {
    let raw = req.uri().path().to_owned();
    // 归一：去首尾斜杠（`/` → 空串 → 阶段 2 拼 `index.html` 命中根 index）
    let path = raw.trim_matches('/').to_owned();

    // 阶段一：扁平 .html（拒绝 ParentDir 段，防穿越）
    if !path.is_empty() {
        let flat = format!("{path}.html");
        if let Some(body) = read_file(&root, &flat).await {
            return Ok(file_response(&flat, body));
        }
    }

    // 阶段二：目录式 index.html（含 `/` 根路径）
    let dir_index = if path.is_empty() {
        "index.html".to_owned()
    } else {
        format!("{path}/index.html")
    };
    if let Some(body) = read_file(&root, &dir_index).await {
        return Ok(file_response(&dir_index, body));
    }

    // 阶段三：SPA fallback（缓存头由外层 cache_and_mime middleware 统一处理）
    match ServeFile::new(root.join("index.html")).oneshot(req).await {
        Ok(resp) => Ok(resp.into_response()),
        Err(_) => Ok(StatusCode::NOT_FOUND.into_response()),
    }
}

/// 读取 root 下相对路径文件；ParentDir / 绝对路径段直接拒绝（防穿越）。
async fn read_file(root: &Path, rel: &str) -> Option<Vec<u8>> {
    let rel_path = PathBuf::from(rel);
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::RootDir))
    {
        return None;
    }
    tokio::fs::read(root.join(rel_path)).await.ok()
}

fn file_response(rel: &str, body: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(rel).first_or_octet_stream();
    ([(header::CONTENT_TYPE, mime.as_ref().to_owned())], body).into_response()
}

/// 缓存矩阵 + MIME 修正（Router::layer 覆盖全部路由，含 fallback）：
/// - `/_app/immutable/*` → 一年 immutable（vite 内容哈希资产）
/// - 其余 → no-cache（协商缓存：ETag/Last-Modified 变化即取新内容）
/// - `.md` → 显式 text/markdown（覆盖 mime_guess 的不可靠推断）
async fn cache_and_mime(req: Request<axum::body::Body>, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut resp = next.run(req).await;
    let headers = resp.headers_mut();

    if path.starts_with("/_app/immutable/") {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    if path.ends_with(".md") {
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/markdown; charset=utf-8"),
        );
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // ---- r6 P1-2：主 PORT 解析（0 与非法值一律拒绝） ----

    #[test]
    fn parse_port_matrix() {
        assert_eq!(parse_port(None).unwrap(), 8080);
        assert_eq!(parse_port(Some(String::new())).unwrap(), 8080);
        assert_eq!(parse_port(Some("  ".to_owned())).unwrap(), 8080);
        assert_eq!(parse_port(Some("8080".to_owned())).unwrap(), 8080);
        assert_eq!(parse_port(Some(" 9090 ".to_owned())).unwrap(), 9090);
        assert_eq!(parse_port(Some("1".to_owned())).unwrap(), 1);
        assert_eq!(parse_port(Some("65535".to_owned())).unwrap(), 65535);
        // r6 P1-2 核心：0 拒绝
        let err = parse_port(Some("0".to_owned())).expect_err("PORT=0 必须拒绝");
        assert!(err.contains("PORT=0"), "错误信息必须指认字段：{err}");
        // 非法值拒绝
        assert!(parse_port(Some("not-a-port".to_owned())).is_err());
        assert!(parse_port(Some("-1".to_owned())).is_err());
        assert!(parse_port(Some("65536".to_owned())).is_err());
        // 空白由 trim 收敛：合法数字带尾随换行照常放行
        assert_eq!(parse_port(Some("8080\n".to_owned())).unwrap(), 8080);
    }

    // ---- r6 P1-8：pinned 预算 checked——极端 manifest 数据溢出必须失败 ----

    #[test]
    fn pinned_budget_overflow_fails() {
        let mut cfg: config::Config =
            toml::from_str(include_str!("../config.example.toml")).unwrap();
        cfg.pinned.keys = vec!["x/1970-01/a.jpg".to_owned(), "x/1970-01/b.jpg".to_owned()];
        let idx = manifest::ManifestIndex::new_for_test_full(
            1,
            HashMap::from([
                (
                    "x/1970-01/a.jpg".to_owned(),
                    manifest::MediaObject {
                        volume: "v".to_owned(),
                        offset: 0,
                        size: u64::MAX,
                        sha256: "0".repeat(64),
                        content_type: "image/jpeg".to_owned(),
                    },
                ),
                (
                    "x/1970-01/b.jpg".to_owned(),
                    manifest::MediaObject {
                        volume: "v".to_owned(),
                        offset: 0,
                        size: 1,
                        sha256: "0".repeat(64),
                        content_type: "image/jpeg".to_owned(),
                    },
                ),
            ]),
            HashMap::new(),
            HashMap::new(),
            String::new(),
        );
        let err = check_pinned_budget(&cfg, &idx).expect_err("合计溢出必须失败");
        assert!(err.contains("溢出"), "{err}");
    }
}
