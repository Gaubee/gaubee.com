//! gaubee.com 静态站服务（axum + tower-http，2026-08-15）。
//!
//! 正交意图：
//! 1. 原始需求（2026-08-15）：nginx 容器 → Rust 自研静态服务，
//!    musl 静态二进制 + scratch 镜像（~15MB，nginx:alpine 的三分之一）。
//!    Pingora 是代理/LB 框架、无静态文件模块，故选 axum + tower-http 标准生态。
//! 2. 查找语义与退役的 deploy/nginx.conf 逐条对齐（四级 try_files）：
//!    `$uri` / `$uri/index.html`（ServeDir 内置）→ `$uri.html`（扁平 SSG，fallback 阶段一）
//!    → `/index.html`（SPA fallback，阶段二；未知路径由 SPA 渲染 NotFound）。
//! 3. 缓存矩阵（Router::layer 覆盖所有路由含 fallback）：默认 no-cache
//!    （协商缓存，发布即时生效）；`/_app/immutable/*`（vite 内容哈希资产）一年 immutable。
//! 4. MIME 修正：`.md` 显式 text/markdown（raw markdown 端点）。
//!
//! 容器内明文 8080（非 root 可绑），TLS 由服务器外层反代负责。

use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};

use axum::http::{header, HeaderValue, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use tower::ServiceExt;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

fn main() {
    let root = PathBuf::from(env::var("SERVER_ROOT").unwrap_or_else(|_| "/srv".into()));
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    // 主体：append_index=false（关闭目录 307 redirect 与自动 index 查找，
    // SSG 双格式与 SPA 兜底全部收口到 fallback 三级查找，语义与 nginx try_files 对齐）。
    // 注意用 .fallback() 而非 .not_found_service()：后者会把响应状态码强制改 404
    //（body 仍输出，浏览器全挂）。
    let root_for_log = root.display().to_string();
    let serve_dir = ServeDir::new(&root)
        .append_index_html_on_directories(false)
        .fallback(tower::service_fn(move |req: Request<axum::body::Body>| {
            fallback(req, root.clone())
        }));

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(serve_dir)
        .layer(middleware::from_fn(cache_and_mime))
        .layer(CompressionLayer::new());

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .unwrap_or_else(|e| panic!("bind {addr} 失败：{e}"));
        eprintln!(
            "gaubee-static-server listening on {addr}, root={}",
            root_for_log
        );
        axum::serve(listener, app).await.expect("server error");
    });
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
