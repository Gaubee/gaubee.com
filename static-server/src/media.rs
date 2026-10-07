//! `/cdn-media/:source/*` handler（A4 媒体 HTTP 语义 + R3 有界拉穿缓存分层）。
//!
//! 路由挂在无中间件的外层 Router 上：结构性绕过全局 CompressionLayer 与通用
//! no-cache 头（8080 主路由改造见 main.rs）。
//!
//! 分层决策（对每个 miss）：
//! - size ≤ large_object_bytes（默认 50MB）或 pinned → 入缓存路径，先过缓存
//!   admission 原子预留（r5 P0-4：per-key single-flight + 全局投影预算）。无 Range
//!   且非严格模式时 stream-through：tee 临时文件流式回客户端（响应头 no-store——
//!   校验通过前不承诺 immutable，r5 P1-7），流毕校验 sha256 通过才原子 rename 入
//!   缓存，失败标 poisoned 拒缓存；有 Range 或严格模式（strict_integrity，且对象
//!   ≤ max_buffer_bytes）时整对象取回校验入缓存后本地伺服 200/206/416（可承诺
//!   immutable）；严格模式超缓冲上限 → 透传
//! - 超阈值 / 超水位 / poisoned / 腾位失败 / 严格模式超上限 → 透传不落盘：边传边
//!   hash（整对象），失败标 poisoned；响应头无缓存承诺（R3：no-store，客户端重试
//!   即得正确副本），Range 透传把上游卷坐标改写为对象坐标的 Content-Range
//!
//! 响应头（命中/已验证入缓存路径）：Cache-Control: public, max-age=31536000,
//! immutable、Accept-Ranges: bytes、Content-Type（manifest content_type）、精确
//! Content-Length。HEAD miss 不回源，用 manifest 元数据合成 200。

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

use crate::cache::DiskCache;
use crate::config::Config;
use crate::manifest::{ManifestIndex, ManifestSource, MediaObject};

/// 对象回源重试（与指针/清单的契约定值相区分）：2 次重试，退避 1s/3s
const OBJECT_RETRY_DELAYS_SECS: [u64; 2] = [1, 3];

pub struct MediaCtx {
    pub cfg: Arc<Config>,
    pub manifest: Arc<ManifestSource>,
    pub cache: Arc<DiskCache>,
    /// 对象回源客户端：无总超时（大对象长流），connect 15s + 读空闲 30s
    pub http: reqwest::Client,
    /// warm 全局并发闸（r6 P1-3）：跨请求共享——所有 admin warm 请求共用同一个
    /// semaphore，杜绝「每个 warm 请求自建独立 semaphore 绕过全局并发边界」
    pub warm_gate: Arc<tokio::sync::Semaphore>,
}

impl MediaCtx {
    pub fn new_client() -> reqwest::Client {
        reqwest::Client::builder()
            .user_agent("gaubee-static-server-cdn-base")
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .build()
            .expect("media http client")
    }
}

// ---- Range 解析（纯函数，矩阵单测覆盖） ----

#[derive(Debug, PartialEq, Eq)]
pub enum RangeSpec {
    /// 无 Range 或语法不可解析/多段（RFC 允许忽略 → 200 全量）
    None,
    /// bytes=<a>-<b>（b 已按 size 收敛）
    Slice(u64, u64),
    /// 起点越界 / 后缀长度为 0 → 416
    Unsatisfiable,
}

pub fn parse_range(header: Option<&str>, size: u64) -> RangeSpec {
    let Some(h) = header else { return RangeSpec::None };
    let Some(spec) = h.strip_prefix("bytes=") else {
        return RangeSpec::None;
    };
    if spec.contains(',') {
        return RangeSpec::None;
    }
    let spec = spec.trim();
    let Some((first, last)) = spec.split_once('-') else {
        return RangeSpec::None;
    };
    if size == 0 {
        return RangeSpec::Unsatisfiable;
    }
    if first.is_empty() {
        // 后缀形式 bytes=-N：最后 N 字节
        let Ok(n) = last.trim().parse::<u64>() else {
            return RangeSpec::None;
        };
        if n == 0 {
            return RangeSpec::Unsatisfiable;
        }
        let start = size.saturating_sub(n);
        return RangeSpec::Slice(start, size - 1);
    }
    let Ok(a) = first.trim().parse::<u64>() else {
        return RangeSpec::None;
    };
    if a >= size {
        return RangeSpec::Unsatisfiable;
    }
    if last.is_empty() {
        return RangeSpec::Slice(a, size - 1);
    }
    let Ok(b) = last.trim().parse::<u64>() else {
        return RangeSpec::None;
    };
    if a > b {
        return RangeSpec::None;
    }
    RangeSpec::Slice(a, b.min(size - 1))
}

// ---- 路径解析 ----

/// /cdn-media/<source>/<key> → (source, key)；白名单外字符/相对段一律拒绝
///（对 raw 路径生效：含 % 一律拒，消除百分号编码二义性）
pub fn parse_media_path(path: &str) -> Result<(String, String), &'static str> {
    let rest = path.strip_prefix("/cdn-media/").ok_or("bad_path")?;
    let (source, key) = rest.split_once('/').ok_or("bad_path")?;
    if !source
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_'))
    {
        return Err("bad_source");
    }
    crate::config::validate_key(key).map_err(|_| "bad_key")?;
    Ok((source.to_owned(), key.to_owned()))
}

// ---- Phase 3 兼容路由（A8/R1：存量 /x-media/* 一次性平移到 /cdn-media/x/*） ----

/// `GET /x-media/<key>` → 302 `/cdn-media/x/<key>`，保留 query。
///
/// 临时重定向语义（302，非 301）：301 会被浏览器与中间代理永久缓存，而本路由计划
/// **在一个版本周期后移除**——旧链接应交由外链/搜索引擎自然衰减，不能被客户端钉死。
/// 路径安全与 [`parse_media_path`] 同口径：raw 路径含 `%` 一律拒（消除百分号编码
/// 二义性）；key 走 `validate_key`（拒绝 `..`/反斜杠/空段/白名单外字符），不合法
/// 一律 404，绝不把穿越段重定向进 /cdn-media 空间。
pub async fn x_media_compat(uri: axum::http::Uri) -> Response {
    let Some(rest) = uri.path().strip_prefix("/x-media/") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rest.is_empty() || rest.contains('%') || crate::config::validate_key(rest).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let target = match uri.query() {
        Some(q) => format!("/cdn-media/x/{rest}?{q}"),
        None => format!("/cdn-media/x/{rest}"),
    };
    (StatusCode::FOUND, [(header::LOCATION, target)]).into_response()
}

// ---- handler ----

pub async fn serve(State(ctx): State<Arc<MediaCtx>>, req: Request<Body>) -> Response {
    let (source, key) = match parse_media_path(req.uri().path()) {
        Ok(v) => v,
        Err(code) => return err_json(StatusCode::BAD_REQUEST, code, None),
    };
    if !ctx.cfg.sources.allow.iter().any(|s| s == &source) {
        return err_json(StatusCode::NOT_FOUND, "unknown_source", Some(&source));
    }
    let canonical = format!("{source}/{key}");
    let is_head = req.method() == Method::HEAD;
    let range_header = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_owned());

    // 磁盘缓存优先（对象不可变：manifest 不可用时已验证副本仍可服务）
    if let Some(path) = ctx.cache.lookup(&canonical) {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let ct = content_type_for(&ctx, &canonical).await;
        if is_head {
            return head_ok(&ct, size);
        }
        let range = parse_range(range_header.as_deref(), size);
        return serve_local(&path, size, &ct, &range).await;
    }

    let (mut index, mut obj) = manifest_obj(&ctx, &canonical).await;

    // 未知 key：TTL 已到期则先刷新一次指针再判 404（新发布对象立即可见；
    // TTL 内零成本返回内存索引）
    if index.is_some() && obj.is_none() {
        if let Some(fresh) = ctx.manifest.refresh_within_ttl().await {
            if fresh.gen != index.as_ref().map(|i| i.gen).unwrap_or(0) {
                obj = fresh.lookup(&canonical).cloned();
                index = Some(fresh);
            }
        }
    }

    // HEAD miss：不回源，用 manifest 元数据合成
    if is_head {
        return match (index.as_ref(), obj.as_ref()) {
            (Some(_), Some(o)) => head_ok(&o.content_type, o.size),
            (Some(_), None) => err_json(StatusCode::NOT_FOUND, "not_found", Some(&canonical)),
            (None, _) => source_unavailable(&source),
        };
    }

    let Some(index) = index else {
        return source_unavailable(&source);
    };
    let Some(obj) = obj else {
        return err_json(StatusCode::NOT_FOUND, "not_found", Some(&canonical));
    };
    let range = parse_range(range_header.as_deref(), obj.size);

    let pinned = ctx.cfg.pinned.keys.iter().any(|k| k == &canonical);
    let cacheable = obj.size <= ctx.cfg.cache.large_object_bytes || pinned;

    // r5 P1-7：严格完整性模式——回源先缓冲全量（≤max_buffer_bytes）校验通过再响应；
    // 超上限对象严格模式下退化为透传（no-store），绝不流式伺服未校验字节
    let strict = ctx.cfg.cache.strict_integrity;
    let strict_unbufferable = strict && obj.size > ctx.cfg.cache.max_buffer_bytes;
    if strict_unbufferable {
        eprintln!(
            "[cdn-media] 严格模式且对象超缓冲上限，透传 {canonical}（{n} 字节，no-store）",
            n = obj.size
        );
    }

    if cacheable && !strict_unbufferable {
        // single-flight（r5 P0-4 / r6 P0-1）：并发同 key miss 只有一个回源者。
        // r6 P0-1：必须取 **owned** flight 守卫——stream-through 场景下响应体在
        // `serve` 返回后仍在下载，借用型守卫会随函数返回提前 Drop，第二个同 key
        // 请求就会重新拿到锁、再次回源并竞争同一个 final path。owned 守卫在 tee
        // 路径移交流状态机（finish/abort/响应体 Drop 才释放），其余路径返回前显
        // 式释放
        let flight = ctx.cache.lock_key_owned(&canonical).await;
        if let Some(path) = ctx.cache.lookup(&canonical) {
            drop(flight);
            return serve_local(&path, obj.size, &obj.content_type, &range).await;
        }
        if !ctx.cache.is_poisoned(&canonical) {
            // admission 原子预留（r5 P0-4）：预留失败 = 超水位/腾位失败 → 透传
            if let Some(res) = ctx.cache.admit(&canonical, obj.size) {
                // 有 Range 或严格模式：整对象取回校验入缓存后本地伺服 200/206/416
                //（整取在本次 await 内完成，守卫随作用域覆盖全程）
                if range != RangeSpec::None || strict {
                    let fetched =
                        fetch_object_to_cache(&ctx, &index, &canonical, &obj, pinned, res).await;
                    drop(flight);
                    return match fetched {
                        Ok(path) => {
                            serve_local(&path, obj.size, &obj.content_type, &range).await
                        }
                        Err(e) => {
                            eprintln!("[cdn-media] 取回失败 {canonical}：{e}");
                            err_json(
                                StatusCode::BAD_GATEWAY,
                                "upstream_error",
                                Some(&canonical),
                            )
                        }
                    };
                }
                // 无 Range 非严格：stream-through tee——响应头 no-store（校验通过前
                // 不承诺 immutable，r5 P1-7），流毕校验通过才入缓存。
                // r6 P0-1：flight 守卫随 TeeState 持有到流结束
                return stream_through_tee(&ctx, &index, &canonical, &obj, pinned, res, flight)
                    .await;
            }
        }
        drop(flight);
        // 超水位拒绝入缓存 / poisoned → 落入透传
    }

    pass_through(&ctx, &index, &obj, &canonical, &range).await
}

async fn manifest_obj(
    ctx: &Arc<MediaCtx>,
    key: &str,
) -> (Option<Arc<ManifestIndex>>, Option<MediaObject>) {
    match ctx.manifest.get().await {
        Some(idx) => {
            let obj = idx.lookup(key).cloned();
            (Some(idx), obj)
        }
        None => (None, None),
    }
}

async fn content_type_for(ctx: &Arc<MediaCtx>, key: &str) -> String {
    let (_, obj) = manifest_obj(ctx, key).await;
    if let Some(o) = obj {
        return o.content_type;
    }
    // 降级服务（manifest 不可用）：按扩展名推断
    mime_guess::from_path(key)
        .first_or_octet_stream()
        .to_string()
}

fn source_unavailable(source: &str) -> Response {
    err_json(
        StatusCode::SERVICE_UNAVAILABLE,
        "source_unavailable",
        Some(source),
    )
}

fn err_json(status: StatusCode, code: &str, subject: Option<&str>) -> Response {
    let body = match subject {
        Some(s) => serde_json::json!({ "error": code, "key": s }),
        None => serde_json::json!({ "error": code }),
    };
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

fn head_ok(ct: &str, len: u64) -> Response {
    let mut resp = (StatusCode::OK, Body::empty()).into_response();
    let h = resp.headers_mut();
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(v) = HeaderValue::from_str(ct) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    resp
}

fn not_satisfiable(size: u64) -> Response {
    let mut resp = err_json(StatusCode::RANGE_NOT_SATISFIABLE, "range_not_satisfiable", None);
    // RFC 9110 要求 416 响应的 Content-Range 值为「bytes 星号 斜杠 size」；
    // 源码字符串禁该两字符相邻序列 → 运行时按字节拼装（产物与规范逐字节一致）。
    // 不用 clippy 建议的字节串字面量（会把该序列写回源码）
    #[allow(clippy::byte_char_slices)]
    let unit_sep = [b'*', b'/'];
    let sep = std::str::from_utf8(&unit_sep).expect("ASCII");
    let unsatisfied = format!("bytes {sep}{size}");
    resp.headers_mut().insert(
        header::CONTENT_RANGE,
        HeaderValue::from_str(&unsatisfied).unwrap(),
    );
    resp
}

/// 本地缓存文件伺服：200 / 206 / 416 全语义（immutable——已验证副本）
async fn serve_local(path: &std::path::Path, size: u64, ct: &str, range: &RangeSpec) -> Response {
    let (status, a, b) = match range {
        RangeSpec::Unsatisfiable => return not_satisfiable(size),
        RangeSpec::None => (StatusCode::OK, 0, size.saturating_sub(1)),
        RangeSpec::Slice(a, b) => (StatusCode::PARTIAL_CONTENT, *a, *b),
    };
    let len = if size == 0 { 0 } else { b - a + 1 };
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[cdn-media] 缓存文件打开失败 {}: {e}", path.display());
            return err_json(StatusCode::BAD_GATEWAY, "cache_io_error", None);
        }
    };
    if a > 0 && file.seek(std::io::SeekFrom::Start(a)).await.is_err() {
        return err_json(StatusCode::BAD_GATEWAY, "cache_io_error", None);
    }
    let reader = file.take(len);
    let mut resp = Response::new(Body::from_stream(ReaderStream::new(reader)));
    *resp.status_mut() = status;
    let h = resp.headers_mut();
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {a}-{b}/{size}")) {
            h.insert(header::CONTENT_RANGE, v);
        }
    }
    if let Ok(v) = HeaderValue::from_str(ct) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    resp
}

/// stream-through（≤阈值 miss、无 Range、非严格模式）：tee 临时文件流式回客户端，
/// 流毕校验 sha256 → 原子 rename 入缓存；失败标 poisoned、临时文件丢弃。
/// 响应头 no-store（r5 P1-7）：字节尚未校验，不承诺 immutable——校验通过前客户端
/// 不得缓存，失败重试即得正确副本。
/// r6 P0-1：`flight` 守卫由调用方移交本函数，封装进 TeeState——锁活到流
/// finish/abort/响应体被 Drop 为止，同 key 后续请求在整个流期间拿不到锁
async fn stream_through_tee(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
    res: crate::cache::Reservation,
    flight: crate::cache::FlightGuard,
) -> Response {
    let Some(url) = index.object_url(&ctx.cfg.github.repo, obj) else {
        drop(res);
        return err_json(StatusCode::BAD_GATEWAY, "volume_unresolved", Some(key));
    };
    // r6 P1-5：卷尺寸是 206 Content-Range total 的对账依据（manifest 冻结 wire 字段）
    let Some(volume_size) = index.volume_size(&obj.volume) else {
        drop(res);
        return err_json(StatusCode::BAD_GATEWAY, "volume_unresolved", Some(key));
    };
    let tmp = ctx.cache.new_tmp_path(key);
    let file = match tokio::fs::File::create(&tmp).await {
        Ok(f) => f,
        Err(e) => {
            drop(res);
            eprintln!("[cdn-media] 临时文件创建失败 {}：{e}", tmp.display());
            ctx.cache.mark_poisoned(key);
            return err_json(StatusCode::BAD_GATEWAY, "cache_io_error", Some(key));
        }
    };
    let resp =
        match object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, None, volume_size).await {
            Ok(r) => r,
            Err(e) => {
                drop(res);
                let _ = std::fs::remove_file(&tmp);
                if matches!(e, FetchError::Integrity(_)) {
                    ctx.cache.mark_poisoned(key);
                }
                eprintln!("[cdn-media] 回源失败 {key}：{e}");
                return err_json(StatusCode::BAD_GATEWAY, "upstream_error", Some(key));
            }
        };

    let state = TeeState {
        upstream: Box::pin(
            resp.bytes_stream()
                .map(|r| r.map_err(|e| Box::new(e) as BoxError)),
        ),
        file: Some(file),
        hasher: Sha256::new(),
        written: 0,
        cache: ctx.cache.clone(),
        tmp,
        final_path: ctx.cache.path_for(key),
        key: key.to_owned(),
        expect_sha: obj.sha256.to_ascii_lowercase(),
        size: obj.size,
        pinned,
        // r5 P0-4：预留随状态机走——finish 转正、abort/Drop 归还
        res: Some(res),
        done: false,
        // r6 P0-1：owned flight 守卫（声明在 res 之后——Drop 按字段序先归还预留
        // 再释放锁，等待者看到的一定是收口后的账目）
        flight,
    };
    // r7 P1-3：单步推进收敛到 TeeState::next_chunk——入口先判 done，abort/finish
    // 之后消费者再多 poll 也立即终止（不消费上游、不重复 finish/abort），
    // 状态机对任意消费者行为闭合
    let body = Body::from_stream(futures_util::stream::unfold(state, |mut st| async move {
        let item = st.next_chunk().await;
        item.map(|item| (item, st))
    }));
    // 头部先行：no-store（r5 P1-7，非严格 tee 校验通过前不承诺 immutable）
    let mut resp = Response::new(body);
    let h = resp.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(v) = HeaderValue::from_str(&obj.content_type) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(obj.size));
    resp
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// tee 流状态机：Drop 兜底清理临时文件（客户端断连导致流被丢弃时）；
/// admission 预留随状态机走——finish 转正、abort/Drop 归还（r5 P0-4）；
/// r6 P0-1：flight 守卫随状态机存活到流结束（Drop 按字段序：先还预留、再放锁）
struct TeeState {
    /// r7 P1-3：错误类型泛化为 BoxError（reqwest 错误在构造处 map），
    /// 测试可用内存流直喂状态机做闭合性验证
    upstream: std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, BoxError>> + Send>>,
    file: Option<tokio::fs::File>,
    hasher: Sha256,
    written: u64,
    cache: Arc<DiskCache>,
    tmp: std::path::PathBuf,
    final_path: std::path::PathBuf,
    key: String,
    expect_sha: String,
    size: u64,
    pinned: bool,
    res: Option<crate::cache::Reservation>,
    done: bool,
    /// r6 P0-1：owned flight 守卫——只在 Drop 时起作用（活到流结束），
    /// 终验/记账路径不读它
    #[allow(dead_code)]
    flight: crate::cache::FlightGuard,
}

impl TeeState {
    /// r7 P1-3：单步推进（unfold 消费的唯一入口）。
    /// done（abort/finish 已收口）时立即返回 None——绝不再消费 upstream、
    /// 绝不再触发 abort/finish，状态机对「错误后继续 poll」「收满后上游
    /// 迟迟不 EOF」等任意消费者行为闭合。
    async fn next_chunk(&mut self) -> Option<Result<bytes::Bytes, BoxError>> {
        if self.done {
            return None;
        }
        match self.upstream.next().await {
            Some(Ok(chunk)) => {
                self.hasher.update(&chunk);
                // r5 P1-9：写盘前 checked 投影——超长/溢出立即中止（删 tmp+poisoned），
                // 绝不把越界字节落到临时文件
                let projected = match self.written.checked_add(chunk.len() as u64) {
                    Some(p) if p <= self.size => p,
                    _ => {
                        self.abort(
                            "上游超长",
                            &format!("written={} chunk={} expect={}", self.written, chunk.len(), self.size),
                        )
                        .await;
                        return Some(Err("upstream over-length".into()));
                    }
                };
                if let Some(f) = self.file.as_mut() {
                    if let Err(e) = f.write_all(&chunk).await {
                        let msg = e.to_string();
                        self.abort("临时文件写入失败", &msg).await;
                        return Some(Err(Box::new(e)));
                    }
                }
                self.written = projected;
                // 关键：不能等流 EOF（None）才终验——hyper 发满 Content-Length 后
                // 不再轮询 body，Drop 兜底会把临时文件当失败清理。对象长度在
                // manifest 里是已知常量，收满即终验+入缓存。
                if self.written == self.size {
                    self.finish().await;
                }
                Some(Ok(chunk))
            }
            Some(Err(e)) => {
                let msg = e.to_string();
                self.abort("回源流中断", &msg).await;
                Some(Err(e))
            }
            None => {
                // 收满路径已在上面终验；这里处理「上游提前断流」（written < size）
                if !self.done {
                    self.abort(
                        "上游提前断流",
                        &format!("written={}/{}", self.written, self.size),
                    )
                    .await;
                }
                None
            }
        }
    }

    async fn abort(&mut self, why: &str, detail: &str) {
        self.done = true;
        self.file = None;
        // res（预留）随 Drop 归还
        let _ = std::fs::remove_file(&self.tmp);
        eprintln!("[cdn-media] {why} {}：{detail}（标 poisoned 拒缓存）", self.key);
        self.cache.mark_poisoned(&self.key);
    }

    async fn finish(&mut self) {
        self.done = true;
        // 先 flush 再关句柄（tokio File 有内部写缓冲，直接 drop 可能丢尾块）
        if let Some(mut f) = self.file.take() {
            if let Err(e) = f.flush().await {
                eprintln!(
                    "[cdn-media] 临时文件 flush 失败 {}：{e}（标 poisoned 拒缓存）",
                    self.tmp.display()
                );
                let _ = std::fs::remove_file(&self.tmp);
                self.cache.mark_poisoned(&self.key);
                return;
            }
        }
        let actual = hex_bytes(&self.hasher.clone().finalize());
        if self.written != self.size || actual != self.expect_sha {
            eprintln!(
                "[cdn-media] sha256 校验失败 {}：written={} expect={} actual={actual}（标 poisoned 拒缓存）",
                self.key, self.written, self.size
            );
            let _ = std::fs::remove_file(&self.tmp);
            self.cache.mark_poisoned(&self.key);
            return;
        }
        // r5 P1-10：create_dir_all/rename 失败统一删 tmp + poisoned（finally 风格收口）
        if let Some(parent) = self.final_path.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                eprintln!(
                    "[cdn-media] 缓存目录创建失败：{e}（删 tmp + poisoned）"
                );
                let _ = std::fs::remove_file(&self.tmp);
                self.cache.mark_poisoned(&self.key);
                return;
            }
        }
        match tokio::fs::rename(&self.tmp, &self.final_path).await {
            Ok(()) => {
                if let Some(res) = self.res.take() {
                    res.commit(self.size, self.pinned);
                }
                eprintln!(
                    "[cdn-media] 缓存入账 {key}（{n} 字节）",
                    key = self.key,
                    n = self.size
                );
            }
            Err(e) => {
                eprintln!(
                    "[cdn-media] 原子 rename 失败 {}：{e}（删 tmp + poisoned）",
                    self.tmp.display()
                );
                let _ = std::fs::remove_file(&self.tmp);
                self.cache.mark_poisoned(&self.key);
            }
        }
    }
}

impl Drop for TeeState {
    fn drop(&mut self) {
        if !self.done {
            self.file = None;
            // res（预留）随 Drop 归还
            let _ = std::fs::remove_file(&self.tmp);
            self.cache.mark_poisoned(&self.key);
        }
    }
}

fn hex_bytes(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// 上游回源错误分类（r5 P1-8）：
/// - Transient：网络/HTTP 状态层问题（可重试，不必然损坏）
/// - Integrity：上游返回与请求不符（206 区间/长度不匹配、offset 溢出等）——
///   按上游错误处理：poisoned + 透传失败
#[derive(Debug)]
pub enum FetchError {
    Transient(String),
    Integrity(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::Transient(m) => write!(f, "{m}"),
            FetchError::Integrity(m) => write!(f, "integrity: {m}"),
        }
    }
}

/// r5 P1-9：写盘前投影校验（tee / 整对象取回 / 透传共用）——返回 Err = 超长或
/// checked_add 溢出，调用方必须立即中止（删 tmp + poisoned）
fn project_chunk(written: u64, chunk_len: usize, expect: u64) -> Result<u64, String> {
    match written.checked_add(chunk_len as u64) {
        Some(p) if p <= expect => Ok(p),
        _ => Err(format!(
            "上游超长：written={written} chunk={chunk_len} expect={expect}"
        )),
    }
}

/// 整对象安装入缓存（r5 P1-10）：create_dir_all + 原子 rename + 预留转正——
/// 任何失败统一删 tmp + poisoned（finally 风格收口，杜绝孤儿 tmp 与账实不符）
async fn install_into_cache(
    ctx: &Arc<MediaCtx>,
    key: &str,
    tmp: &std::path::Path,
    res: crate::cache::Reservation,
    pinned: bool,
    size: u64,
) -> Result<std::path::PathBuf, String> {
    let final_path = ctx.cache.path_for(key);
    let result = async {
        if let Some(parent) = final_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("缓存目录创建失败：{e}"))?;
        }
        tokio::fs::rename(tmp, &final_path)
            .await
            .map_err(|e| format!("rename 失败：{e}"))?;
        Ok(final_path.clone())
    }
    .await;
    match result {
        Ok(p) => {
            res.commit(size, pinned);
            eprintln!("[cdn-media] 缓存入账 {key}（{n} 字节）", n = size);
            Ok(p)
        }
        Err(e) => {
            let _ = std::fs::remove_file(tmp);
            ctx.cache.mark_poisoned(key);
            Err(e)
        }
    }
}

/// 整对象取回→校验→入缓存（Range miss / 严格模式 / warm 共用）。
/// 调用方必须先 `cache.admit` 取得预留（r5 P0-4）。
pub async fn fetch_object_to_cache(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
    res: crate::cache::Reservation,
) -> Result<std::path::PathBuf, String> {
    let url = index
        .object_url(&ctx.cfg.github.repo, obj)
        .ok_or_else(|| format!("卷未解析：{}", obj.volume))?;
    // r6 P1-4：206 total 对账需要卷尺寸（manifest 冻结字段）
    let volume_size = index
        .volume_size(&obj.volume)
        .ok_or_else(|| format!("卷尺寸未声明：{}", obj.volume))?;
    let tmp = ctx.cache.new_tmp_path(key);
    let fetch = async {
        let resp = object_fetch(
            &ctx.http,
            &ctx.cfg.github.token,
            &url,
            obj,
            None,
            volume_size,
        )
        .await
        .map_err(|e| e.to_string())?;
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("临时文件创建失败：{e}"))?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut stream = resp.bytes_stream();
        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| format!("回源流中断：{e}"))?;
            hasher.update(&chunk);
            // r5 P1-9：写盘前 checked 投影，超长立即中止（Err 路径统一删 tmp+poisoned）
            written = project_chunk(written, chunk.len(), obj.size)?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("临时文件写入失败：{e}"))?;
        }
        file.flush().await.map_err(|e| format!("flush 失败：{e}"))?;
        drop(file);
        let actual = hex_bytes(&hasher.finalize());
        if written != obj.size || actual != obj.sha256.to_ascii_lowercase() {
            return Err(format!(
                "sha256 校验失败：written={written} expect={n} actual={actual}",
                n = obj.size
            ));
        }
        Ok(())
    };
    match fetch.await {
        Ok(()) => install_into_cache(ctx, key, &tmp, res, pinned, obj.size).await,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            ctx.cache.mark_poisoned(key);
            Err(e)
        }
    }
}

/// warm/取回结果（serve cacheable 分支与 admin::warm 共用路径，r5 P0-4）
#[derive(Debug)]
pub enum WarmOutcome {
    AlreadyCached,
    Warmed,
    /// admission 拒绝（超水位/腾位失败）或 poisoned 窗口内
    NoRoom,
    Failed(String),
}

/// 单 key 预热/取回公共路径（r5 P0-4）：per-key single-flight 门 → 缓存重查 →
/// poisoned 检查 → admission 原子预留 → 整对象取回校验入缓存。
/// admin::warm 与 serve 的取回分支都收敛到同一 admission/single-flight 语义。
pub async fn warm_one(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
) -> WarmOutcome {
    // lock_key 守卫即锁：await 返回后独占持锁
    let _guard = ctx.cache.lock_key(key).await;
    if ctx.cache.lookup(key).is_some() {
        return WarmOutcome::AlreadyCached;
    }
    if ctx.cache.is_poisoned(key) {
        return WarmOutcome::NoRoom;
    }
    let Some(res) = ctx.cache.admit(key, obj.size) else {
        return WarmOutcome::NoRoom;
    };
    match fetch_object_to_cache(ctx, index, key, obj, pinned, res).await {
        Ok(_) => WarmOutcome::Warmed,
        Err(e) => WarmOutcome::Failed(e),
    }
}

/// r5 P1-8 / r6 P1-4：精确校验上游 206 的 Content-Range 与 Content-Length 与请求一致。
/// Content-Range 必须完整解析为 `bytes <start>-<end>/<total>`：
/// start/end 与请求区间逐值相等，total 为合法数值且与卷尺寸（manifest 冻结字段）
/// 一致——上游谎报总长度（如分卷漂移后的错误定位）必须被识别为 Integrity。
fn validate_upstream_206(
    resp: reqwest::Response,
    start: u64,
    end: u64,
    expect_len: u64,
    volume_size: u64,
) -> Result<reqwest::Response, FetchError> {
    let integrity = |m: String| FetchError::Integrity(m);
    let cr = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| integrity("206 响应缺 Content-Range".to_owned()))?;
    let reject_cr = |got: &str| {
        integrity(format!(
            "Content-Range 与请求不一致：got={got:?} want=bytes {start}-{end}/{volume_size}"
        ))
    };
    // 完整语法：bytes <start>-<end>/<total>（`*` 通配/缺 denominator/多余段一律拒绝）
    let rest = cr.strip_prefix("bytes ").ok_or_else(|| reject_cr(cr))?;
    let (range_part, total_part) = rest.split_once('/').ok_or_else(|| {
        integrity(format!("Content-Range 缺 total（denominator）：got={cr:?}"))
    })?;
    let total: u64 = total_part.trim().parse().map_err(|_| {
        integrity(format!(
            "Content-Range total 非法：got={total_part:?}（want {volume_size}）"
        ))
    })?;
    if total != volume_size {
        return Err(integrity(format!(
            "Content-Range total 与卷尺寸不符：got={total} want={volume_size}"
        )));
    }
    let (got_start, got_end) = range_part
        .split_once('-')
        .ok_or_else(|| reject_cr(cr))?;
    let got_start: u64 = got_start
        .trim()
        .parse()
        .map_err(|_| reject_cr(cr))?;
    let got_end: u64 = got_end.trim().parse().map_err(|_| reject_cr(cr))?;
    if got_start != start || got_end != end {
        return Err(reject_cr(cr));
    }
    let cl = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| integrity("206 响应缺 Content-Length 或非法".to_owned()))?;
    if cl != expect_len {
        return Err(integrity(format!(
            "Content-Length 与请求不一致：got={cl} want={expect_len}"
        )));
    }
    Ok(resp)
}

/// 对象字节范围回源：总是携带对象坐标 Range（上游若回 200 = 整卷 → 拒绝，防误拉百 MB 卷）。
/// 206 响应必须通过 Content-Range/Content-Length 精确校验（r5 P1-8 / r6 P1-4：含
/// `/total` 与卷尺寸对账）；offset 与区间长度计算全部 checked（r6 P1-8），畸形
/// manifest 数据不得回绕成错误区间。零字节对象在回源前明确拒绝（r6 P1-8：杜绝
/// `saturating_sub(1)` 回绕出的错误一字节请求）
async fn object_fetch(
    http: &reqwest::Client,
    token: &str,
    url: &str,
    obj: &MediaObject,
    sub_range: Option<(u64, u64)>,
    volume_size: u64,
) -> Result<reqwest::Response, FetchError> {
    let integrity = |m: String| FetchError::Integrity(m);
    if obj.size == 0 {
        return Err(integrity(
            "零字节对象拒绝回源（manifest wire 校验应已拦截）".to_owned(),
        ));
    }
    let (a, b) = sub_range.unwrap_or((0, obj.size - 1));
    let start = obj
        .offset
        .checked_add(a)
        .ok_or_else(|| integrity(format!("offset 溢出：offset={} + a={a}", obj.offset)))?;
    let end = obj
        .offset
        .checked_add(b)
        .ok_or_else(|| integrity(format!("offset 溢出：offset={} + b={b}", obj.offset)))?;
    let expect_len = b
        .checked_sub(a)
        .and_then(|d| d.checked_add(1))
        .ok_or_else(|| integrity(format!("请求区间长度溢出：a={a} b={b}")))?;
    let range_value = format!("bytes={start}-{end}");
    let mut last_err = String::new();
    for attempt in 0..=OBJECT_RETRY_DELAYS_SECS.len() {
        if attempt > 0 {
            let delay = OBJECT_RETRY_DELAYS_SECS[attempt - 1];
            eprintln!("[cdn-media] 对象回源失败（第 {attempt} 次重试，退避 {delay}s）：{last_err}");
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
        let mut req = http
            .get(url)
            .header("Accept", "application/octet-stream")
            .header(reqwest::header::RANGE, &range_value);
        if !token.is_empty() {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
        }
        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status == reqwest::StatusCode::PARTIAL_CONTENT {
                    return validate_upstream_206(resp, start, end, expect_len, volume_size);
                }
                if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::GONE {
                    return Err(FetchError::Transient(format!(
                        "asset 已不存在（HTTP {status}，不重试）：{url}"
                    )));
                }
                last_err = format!("HTTP {status}（期望 206）");
            }
            Err(e) => {
                last_err = format!("{e}");
            }
        }
    }
    Err(FetchError::Transient(format!(
        "对象回源重试耗尽：{range_value}：{last_err}"
    )))
}

/// 透传（>阈值 / 超水位 / poisoned / 腾位失败）：不落盘。
/// 整对象：边传边 hash，失败标 poisoned；响应头无缓存承诺（R3：no-store）。
/// Range：上游卷坐标映射为对象坐标改写 Content-Range；子集无法对照整对象
/// sha256，如实透传。
async fn pass_through(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    obj: &MediaObject,
    key: &str,
    range: &RangeSpec,
) -> Response {
    let Some(url) = index.object_url(&ctx.cfg.github.repo, obj) else {
        return err_json(StatusCode::BAD_GATEWAY, "volume_unresolved", Some(key));
    };
    let Some(volume_size) = index.volume_size(&obj.volume) else {
        return err_json(StatusCode::BAD_GATEWAY, "volume_unresolved", Some(key));
    };
    let sub = match range {
        RangeSpec::None => None,
        RangeSpec::Slice(a, b) => Some((*a, *b)),
        RangeSpec::Unsatisfiable => return not_satisfiable(obj.size),
    };
    let resp = match object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, sub, volume_size)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // r5 P1-8：上游 206 与请求不符 = Integrity → poisoned + 透传失败
            if matches!(e, FetchError::Integrity(_)) {
                ctx.cache.mark_poisoned(key);
            }
            eprintln!("[cdn-media] 透传回源失败 {key}：{e}");
            return err_json(StatusCode::BAD_GATEWAY, "upstream_error", Some(key));
        }
    };

    let (status, cl) = match sub {
        None => (StatusCode::OK, obj.size),
        Some((a, b)) => (StatusCode::PARTIAL_CONTENT, b - a + 1),
    };
    let state = sub.is_none().then(|| {
        (
            Sha256::new(),
            obj.sha256.to_ascii_lowercase(),
            key.to_owned(),
            ctx.cache.clone(),
            // 透传整对象长度已知：收满即终验（不能等流被 hyper 丢弃）
            0u64,
            obj.size,
        )
    });
    let body = Body::from_stream(HashedStream {
        inner: Box::pin(
            resp.bytes_stream()
                .map(|r| r.map_err(|e| Box::new(e) as BoxError)),
        ),
        state,
    });

    let mut resp = Response::new(body);
    *resp.status_mut() = status;
    let h = resp.headers_mut();
    // R3：透传响应头无缓存承诺——失败重试即得正确副本
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(v) = HeaderValue::from_str(&obj.content_type) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(cl));
    if let Some((a, b)) = sub {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {a}-{b}/{}", obj.size)) {
            h.insert(header::CONTENT_RANGE, v);
        }
    }
    resp
}

/// 包装透传流：整对象场景在收满 size 字节时做 sha256 终验，失败标 poisoned
///（响应已出且无缓存承诺，客户端重试即得正确副本）；
/// received 超出 expect（checked 投影）也 poisoned 并终止流（r5 P1-9）。
/// inner 错误类型泛化为 BoxError（reqwest 错误在构造处 map），测试可用内存流直喂
struct HashedStream {
    inner: std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, BoxError>> + Send>>,
    state: Option<(Sha256, String, String, Arc<DiskCache>, u64, u64)>,
}

impl futures_util::Stream for HashedStream {
    type Item = Result<bytes::Bytes, BoxError>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        match self.inner.as_mut().poll_next(cx) {
            std::task::Poll::Ready(Some(Ok(chunk))) => {
                // r5 P1-9：写前 checked 投影——超长/溢出 → poisoned + 终止流
                let overlong = match self.state.as_mut() {
                    Some((h, _, _, _, received, expect_size)) => {
                        use sha2::Digest;
                        h.update(&chunk);
                        match received.checked_add(chunk.len() as u64) {
                            Some(p) if p <= *expect_size => {
                                *received = p;
                                false
                            }
                            _ => true,
                        }
                    }
                    None => false,
                };
                if overlong {
                    if let Some((h, _expect, key, cache, received, expect_size)) = self.state.take() {
                        let actual = hex_bytes(&h.finalize());
                        eprintln!(
                            "[cdn-media] 透传上游超长 {key}：received={} chunk={} expect={expect_size} actual={actual}（标 poisoned，终止流）",
                            received,
                            chunk.len()
                        );
                        cache.mark_poisoned(&key);
                    }
                    return std::task::Poll::Ready(Some(Err(
                        "upstream over-length".into()
                    )));
                }
                let filled =
                    matches!(self.state.as_ref(), Some((_, _, _, _, received, expect_size)) if received == expect_size);
                if filled {
                    // 收满即终验：hyper 发满 Content-Length 后不再轮询
                    if let Some((h, expect, key, cache, _, _)) = self.state.take() {
                        let actual = hex_bytes(&h.finalize());
                        if actual != expect {
                            eprintln!(
                                "[cdn-media] 透传 sha256 校验失败 {key}：actual={actual}（标 poisoned）"
                            );
                            cache.mark_poisoned(&key);
                        }
                    }
                }
                std::task::Poll::Ready(Some(Ok(chunk)))
            }
            std::task::Poll::Ready(Some(Err(e))) => {
                if let Some((_, _, key, cache, _, _)) = self.state.take() {
                    cache.mark_poisoned(&key);
                }
                std::task::Poll::Ready(Some(Err(e)))
            }
            std::task::Poll::Ready(None) => {
                // 上游提前断流（未收满）——终验没机会执行，标 poisoned
                if let Some((h, _expect, key, cache, received, expect_size)) = self.state.take() {
                    if received < expect_size {
                        let actual = hex_bytes(&h.finalize());
                        eprintln!(
                            "[cdn-media] 透传上游提前断流 {key}：{received}/{expect_size} actual={actual}（标 poisoned）"
                        );
                        cache.mark_poisoned(&key);
                    }
                }
                std::task::Poll::Ready(None)
            }
            std::task::Poll::Pending => std::task::Poll::Pending,
        }
    }
}

/// r7 P1-4：Drop 收口——客户端中途断开（响应体未消费完即被丢弃）时，state 尚未
/// 走完任一终态（收满终验 / 错误 / EOF 对账），视为透传失败标 poisoned：
/// 半截透传绝不当作成功放行（响应头本就 no-store，重试即得正确副本）。
/// 终态路径都会 take() 清空 state，Drop 只在「半途丢弃」这一种情况起作用。
impl Drop for HashedStream {
    fn drop(&mut self) {
        if let Some((_, _, key, cache, received, expect_size)) = self.state.take() {
            eprintln!(
                "[cdn-media] 透传响应被中途丢弃 {key}：{received}/{expect_size}（标 poisoned）"
            );
            cache.mark_poisoned(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    use crate::cache::DiskCache;
    use crate::manifest::{ManifestIndex, ManifestSource};
    use crate::test_support::{
        sha256_hex, spawn_object_mock, ObjectMockState,
    };

    // ---- 纯函数矩阵 ----

    // ---- Phase 3 兼容路由（A8/R1）：/x-media/* → 302 /cdn-media/x/* ----

    async fn compat_get(path: &str) -> Response {
        use tower::ServiceExt;
        let app = axum::Router::new().route(
            "/x-media/{*rest}",
            axum::routing::get(super::x_media_compat),
        );
        app.oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn x_media_compat_redirects_with_query() {
        let resp = compat_get("/x-media/2026-07/foo.jpg?w=120").await;
        assert_eq!(resp.status(), StatusCode::FOUND, "必须 302（临时重定向语义）");
        assert_eq!(
            resp.headers().get(header::LOCATION).unwrap(),
            "/cdn-media/x/2026-07/foo.jpg?w=120",
            "Location 必须指向 /cdn-media/x/ 并保留 query"
        );
    }

    #[tokio::test]
    async fn x_media_compat_redirects_without_query() {
        let resp = compat_get("/x-media/2026-10/123-video.mp4").await;
        assert_eq!(resp.status(), StatusCode::FOUND);
        assert_eq!(
            resp.headers().get(header::LOCATION).unwrap(),
            "/cdn-media/x/2026-10/123-video.mp4"
        );
    }

    #[tokio::test]
    async fn x_media_compat_rejects_traversal_and_garbage() {
        // `..` 穿越段：绝不重定向进 /cdn-media 空间
        let resp = compat_get("/x-media/../secret.jpg").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND, "穿越段必须 404");
        // 反斜杠
        let resp = compat_get("/x-media/2026-07/a%5Cb.jpg").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND, "raw 路径含 % 一律 404（与 serve 同口径）");
        // 白名单外字符（URI 合法但不在 key 白名单：~ 只允许 A-Za-z0-9._-）
        let resp = compat_get("/x-media/2026-07/a~b.jpg").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND, "白名单外字符必须 404");
        // 空 rest
        let resp = compat_get("/x-media/").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn range_matrix() {
        let size = 100u64;
        assert_eq!(parse_range(None, size), RangeSpec::None);
        assert_eq!(parse_range(Some("bytes=0-99"), size), RangeSpec::Slice(0, 99));
        assert_eq!(parse_range(Some("bytes=0-"), size), RangeSpec::Slice(0, 99));
        assert_eq!(parse_range(Some("bytes=10-19"), size), RangeSpec::Slice(10, 19));
        // b 越界 → 收敛到 size-1
        assert_eq!(parse_range(Some("bytes=90-999"), size), RangeSpec::Slice(90, 99));
        // 后缀
        assert_eq!(parse_range(Some("bytes=-10"), size), RangeSpec::Slice(90, 99));
        assert_eq!(parse_range(Some("bytes=-500"), size), RangeSpec::Slice(0, 99));
        assert_eq!(parse_range(Some("bytes=-0"), size), RangeSpec::Unsatisfiable);
        // 起点越界 → 416
        assert_eq!(parse_range(Some("bytes=100-"), size), RangeSpec::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=200-300"), size), RangeSpec::Unsatisfiable);
        // 语法不可解析/多段 → 忽略（200 全量）
        assert_eq!(parse_range(Some("bytes=5-2"), size), RangeSpec::None);
        assert_eq!(parse_range(Some("bytes=0-9,20-29"), size), RangeSpec::None);
        assert_eq!(parse_range(Some("items=0-9"), size), RangeSpec::None);
        assert_eq!(parse_range(Some("bytes=a-b"), size), RangeSpec::None);
        // 空对象
        assert_eq!(parse_range(Some("bytes=0-"), 0), RangeSpec::Unsatisfiable);
    }

    #[test]
    fn path_matrix() {
        assert_eq!(
            parse_media_path("/cdn-media/x/1970-01/a.jpg").unwrap(),
            ("x".to_owned(), "1970-01/a.jpg".to_owned())
        );
        assert!(parse_media_path("/cdn-media/x/..%2F..%2Fetc").is_err());
        assert!(parse_media_path("/cdn-media/x/a b.jpg").is_err());
        assert!(parse_media_path("/cdn-media/x/../y").is_err());
        assert!(parse_media_path("/cdn-media/x/a\\b").is_err());
        assert!(parse_media_path("/cdn-media/UPPER/a.jpg").is_err());
        assert!(parse_media_path("/other/x/a.jpg").is_err());
    }

    /// r5 P1-9：写盘前 checked 投影矩阵
    #[test]
    fn project_chunk_matrix() {
        assert_eq!(project_chunk(0, 10, 100).unwrap(), 10);
        assert_eq!(project_chunk(90, 10, 100).unwrap(), 100, "恰好收满允许");
        assert!(project_chunk(91, 10, 100).is_err(), "超长必须拒绝");
        assert!(project_chunk(u64::MAX, 1, u64::MAX).is_err(), "溢出必须拒绝");
        assert!(project_chunk(0, 5, 0).is_err(), "expect=0 时任何 chunk 都超长");
    }

    // ---- mock 上游基座 ----

    const VOLUME: &str = "vol-test.tar";

    async fn test_ctx(name: &str) -> (Arc<MediaCtx>, std::path::PathBuf) {
        let cache_root = std::env::temp_dir().join(format!("cdn-media-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache_root);
        let cfg = Arc::new(crate::test_support::test_config_default_cache(
            "http://127.0.0.1:9/manifest/current.json".to_owned(),
            cache_root.display().to_string(),
        ));
        let manifest = Arc::new(ManifestSource::new(cfg.clone()));
        let cache = Arc::new(DiskCache::recover(
            &cache_root,
            cfg.cache.high_bytes,
            cfg.cache.low_bytes,
            &HashSet::new(),
        )
        .unwrap());
        let ctx = Arc::new(MediaCtx {
            cfg,
            manifest,
            cache,
            http: MediaCtx::new_client(),
            warm_gate: Arc::new(tokio::sync::Semaphore::new(crate::admin::WARM_CONCURRENCY)),
        });
        (ctx, cache_root)
    }

    fn test_index(url_base: &str) -> Arc<ManifestIndex> {
        Arc::new(ManifestIndex::new_for_test(
            1,
            HashMap::from([(VOLUME.to_owned(), 42u64)]),
            HashMap::from([(VOLUME.to_owned(), 2048u64)]),
            url_base.to_owned(),
        ))
    }

    fn test_obj(body: &[u8]) -> MediaObject {
        MediaObject {
            volume: VOLUME.to_owned(),
            offset: 512,
            size: body.len() as u64,
            sha256: sha256_hex(body),
            content_type: "image/jpeg".to_owned(),
        }
    }

    fn tmp_dir_of(root: &std::path::Path) -> std::path::PathBuf {
        root.join("tmp")
    }

    fn assert_tmp_empty(root: &std::path::Path) {
        assert_eq!(
            std::fs::read_dir(tmp_dir_of(root)).map(|d| d.count()).unwrap_or(0),
            0,
            "tmp/ 必须无残留 .part"
        );
    }

    // ---- r5 P1-8：上游 206 精确校验 ----

    #[tokio::test]
    async fn object_fetch_206_exact_match_ok() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-514/2048".to_owned(),
            body,
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = test_ctx("fetch-ok").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let resp = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect("精确匹配的 206 必须通过");
        assert_eq!(resp.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            st.lock().unwrap().last_range.lock().unwrap().as_deref(),
            Some("bytes=512-514"),
            "请求 Range 必须是对象坐标（offset+sub）"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_wrong_content_range_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some("bytes 999-1001/2048".to_owned()),
            content_length: None,
            body: body.clone(),
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-wrong-cr").await;
        let obj = test_obj(&body);
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("Content-Range 不符必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "必须是 Integrity：{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_wrong_content_length_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some("bytes 512-514/2048".to_owned()),
            content_length: Some("2".to_owned()),
            body,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-wrong-cl").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("Content-Length 不符必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_missing_content_range_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: None,
            content_length: None,
            body,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-no-cr").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("缺 Content-Range 必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-8：offset checked_add——畸形 manifest 数据不得回绕成错误区间
    #[tokio::test]
    async fn object_fetch_offset_overflow_is_integrity_without_request() {
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 0-0/1".to_owned(),
            b"a".to_vec(),
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = test_ctx("fetch-overflow").await;
        let mut obj = test_obj(b"abc");
        obj.offset = u64::MAX;
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("offset 溢出必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "{err:?}");
        assert_eq!(st.lock().unwrap().hits(), 0, "溢出必须在发请求前拦截");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- P1-10 / P0-4：取回→安装→清理 ----

    #[tokio::test]
    async fn fetch_object_to_cache_roundtrip() {
        let body = b"hello-object-bytes".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body.clone(),
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("roundtrip").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(&body);
        let key = "x/2020-01/roundtrip.jpg";
        let res = ctx.cache.admit(key, obj.size).expect("admission 应通过");
        let path = fetch_object_to_cache(&ctx, &index, key, &obj, false, res)
            .await
            .expect("取回安装必须成功");
        assert_eq!(std::fs::read(&path).unwrap(), body, "落盘字节与上游一致");
        assert!(ctx.cache.lookup(key).is_some(), "必须入账可命中");
        assert_eq!(ctx.cache.total(), body.len() as u64);
        assert!(!ctx.cache.is_poisoned(key));
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn fetch_object_to_cache_sha_mismatch_poisons() {
        // 与预期对象等长但内容不同 → 头校验通过、sha 校验失败
        let expect_plain = b"expected-other-content";
        let body = vec![b'X'; expect_plain.len()];
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("sha-bad").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(b"expected-other-content");
        let key = "x/2020-01/shabad.jpg";        let res = ctx.cache.admit(key, obj.size).expect("admission 应通过");
        let err = fetch_object_to_cache(&ctx, &index, key, &obj, false, res)
            .await
            .expect_err("sha 不符必须失败");
        assert!(err.contains("sha256"), "{err}");
        assert!(ctx.cache.lookup(key).is_none(), "损坏数据不得入缓存");
        assert!(ctx.cache.is_poisoned(key), "必须标 poisoned");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-10：rename 失败（目标被目录占位）→ 统一删 tmp + poisoned
    #[tokio::test]
    async fn fetch_object_to_cache_rename_failure_cleans() {
        let body = b"payload".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("rename-fail").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(b"payload");
        let key = "x/2020-01/renameme.jpg";
        // 目标位置被空目录占位 → rename 必败（EISDIR/ENOTDIR）
        std::fs::create_dir_all(ctx.cache.path_for(key)).unwrap();
        let res = ctx.cache.admit(key, obj.size).expect("admission 应通过");
        let err = fetch_object_to_cache(&ctx, &index, key, &obj, false, res)
            .await
            .expect_err("rename 失败必须报错");
        assert!(err.contains("rename"), "{err}");
        assert!(ctx.cache.lookup(key).is_none());
        assert!(ctx.cache.is_poisoned(key), "安装失败必须标 poisoned");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P0-4：重复 warm 同 key 只回源一次（single-flight + 缓存重查）
    #[tokio::test]
    async fn warm_one_single_flight_single_fetch() {
        let body = b"warm-payload".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body,
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = test_ctx("warm-single").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(b"warm-payload");
        let key = "x/2020-01/warm.jpg";

        let (a, b) = tokio::join!(
            warm_one(&ctx, &index, key, &obj, false),
            warm_one(&ctx, &index, key, &obj, false),
        );
        for o in [&a, &b] {
            assert!(!matches!(o, WarmOutcome::Failed(_)), "warm 不应失败：{o:?}");
        }
        let outcomes = [std::mem::discriminant(&a), std::mem::discriminant(&b)];
        assert!(
            outcomes.contains(&std::mem::discriminant(&WarmOutcome::Warmed))
                && outcomes.contains(&std::mem::discriminant(&WarmOutcome::AlreadyCached)),
            "并发同 key warm 必须一次 Warmed 一次 AlreadyCached：{a:?} {b:?}"
        );
        // 第三次（顺序）也必须 AlreadyCached，不回源
        assert!(matches!(warm_one(&ctx, &index, key, &obj, false).await, WarmOutcome::AlreadyCached));
        assert_eq!(st.lock().unwrap().hits(), 1, "重复 warm 同 key 只回源一次");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- r5 P1-7：tee 响应头 no-store + 校验后入缓存 ----

    #[tokio::test]
    async fn tee_serves_no_store_and_caches_after_verify() {
        let body = b"tee-payload-bytes".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body.clone(),
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("tee-ok").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(&body);
        let key = "x/2020-01/tee.jpg";
        let res = ctx.cache.admit(key, obj.size).expect("admission 应通过");
        let resp = stream_through_tee(&ctx, &index, key, &obj, false, res, ctx.cache.lock_key_owned(key).await).await;
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store", "tee 头不得承诺 immutable");
        assert_eq!(resp.headers().get("content-length").unwrap(), &obj.size.to_string());
        let got = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("body 必须完整送达客户端");
        assert_eq!(&got[..], &body[..]);
        // 流毕校验通过 → 入缓存
        assert!(ctx.cache.lookup(key).is_some(), "校验通过必须入缓存");
        assert_eq!(ctx.cache.total(), body.len() as u64);
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn tee_sha_mismatch_delivers_but_never_caches() {
        // 与预期对象等长但内容不同 → 头校验通过、流毕 sha 校验失败
        let expect_plain = b"expected-torrent-of-other-bytes";
        let body = vec![b'X'; expect_plain.len()];
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body.clone(),
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("tee-bad").await;
        let index = test_index(&format!("http://{addr}"));
        let obj = test_obj(b"expected-torrent-of-other-bytes");
        let key = "x/2020-01/teebad.jpg";
        let res = ctx.cache.admit(key, obj.size).expect("admission 应通过");
        let resp = stream_through_tee(&ctx, &index, key, &obj, false, res, ctx.cache.lock_key_owned(key).await).await;
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        let got = axum::body::to_bytes(resp.into_body(), usize::MAX).await.expect("no-store 下坏字节仍如实送达");
        assert_eq!(got.len(), body.len());
        assert!(ctx.cache.lookup(key).is_none(), "校验失败不得入缓存");
        assert!(ctx.cache.is_poisoned(key));
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r7 P1-3：tee 状态机闭合（内存流直喂）——上游 Err（abort 收口）之后消费者
    /// 再多 poll：立即返回 None，不再消费上游（错误后残留的 Ok 块不得再进入
    /// hasher/文件）、不再触发 finish/abort；poisoned、tmp 已删、预留与锁随 Drop 全归还
    #[tokio::test]
    async fn tee_state_after_error_poll_is_terminal() {
        let full = b"tee-close-after-error-payload".to_vec();
        let (ctx, root) = test_ctx("tee-close-err").await;
        let key = "x/2020-01/teecloseerr.jpg";
        let res = ctx.cache.admit(key, full.len() as u64).expect("admission 应通过");
        let tmp = ctx.cache.new_tmp_path(key);
        let file = tokio::fs::File::create(&tmp).await.expect("tmp file");
        // 上游剧本：8 字节 → Err（断流）→ 又一段 Ok（异常流在错误后继续出数据）
        let err_item: BoxError =
            Box::new(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "mock reset"));
        let upstream: std::pin::Pin<
            Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, BoxError>> + Send>,
        > = Box::pin(futures_util::stream::iter(vec![
            Ok(bytes::Bytes::from(full[..8].to_vec())),
            Err(err_item),
            Ok(bytes::Bytes::from(full[8..].to_vec())),
        ]));
        let mut st = TeeState {
            upstream,
            file: Some(file),
            hasher: Sha256::new(),
            written: 0,
            cache: ctx.cache.clone(),
            tmp: tmp.clone(),
            final_path: ctx.cache.path_for(key),
            key: key.to_owned(),
            expect_sha: sha256_hex(&full),
            size: full.len() as u64,
            pinned: false,
            res: Some(res),
            done: false,
            flight: ctx.cache.lock_key_owned(key).await,
        };
        let first = st
            .next_chunk()
            .await
            .expect("第一块必须送达")
            .expect("第一块必须为 Ok");
        assert_eq!(&first[..], &full[..8]);
        assert!(
            st.next_chunk().await.expect("Err 帧必须转出").is_err(),
            "上游 Err 必须以错误帧转出（abort 已触发）"
        );
        // 核心断言：done 后再 poll 必须 None——错误后残留的 Ok 块绝不再被消费
        assert!(st.next_chunk().await.is_none(), "abort 后再 poll 必须立即终止");
        assert!(st.next_chunk().await.is_none(), "重复 poll 持续幂等终止");
        assert!(ctx.cache.is_poisoned(key), "断流必须标 poisoned");
        assert!(ctx.cache.lookup(key).is_none(), "断流不得入缓存");
        assert!(!tmp.exists(), "abort 必须删除临时文件");
        assert_tmp_empty(&root);
        // 状态机存续期间预留仍持有；Drop（body 丢弃）后必须全部归还
        drop(st);
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "预留必须随 Drop 归还");
        assert_eq!(ctx.cache.total(), 0, "失败路径不得入账");
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "锁表必须随 Drop 摘除");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r7 P1-3：收满 size 即 finish（commit+rename），此后上游迟迟不 EOF——
    /// done 后再 poll 立即 None，绝不再等待/消费上游（有界超时证明不挂起）
    #[tokio::test]
    async fn tee_state_full_length_silent_upstream_commits_and_closes() {
        let full = b"tee-full-length-silent-upstream".to_vec();
        let (ctx, root) = test_ctx("tee-silent").await;
        let key = "x/2020-01/teesilent.jpg";
        let expect_sha = sha256_hex(&full);
        let size = full.len() as u64;
        let res = ctx.cache.admit(key, size).expect("admission 应通过");
        let tmp = ctx.cache.new_tmp_path(key);
        let file = tokio::fs::File::create(&tmp).await.expect("tmp file");
        // 上游剧本：一次性发满 size 字节后永远 Pending（不发 EOF）
        let upstream: std::pin::Pin<
            Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, BoxError>> + Send>,
        > = Box::pin(
            futures_util::stream::once(async move { Ok(bytes::Bytes::from(full)) })
                .chain(futures_util::stream::pending::<Result<bytes::Bytes, BoxError>>()),
        );
        let mut st = TeeState {
            upstream,
            file: Some(file),
            hasher: Sha256::new(),
            written: 0,
            cache: ctx.cache.clone(),
            tmp: tmp.clone(),
            final_path: ctx.cache.path_for(key),
            key: key.to_owned(),
            expect_sha,
            size,
            pinned: false,
            res: Some(res),
            done: false,
            flight: ctx.cache.lock_key_owned(key).await,
        };
        let chunk = st
            .next_chunk()
            .await
            .expect("收满块必须送达")
            .expect("收满块必须为 Ok");
        assert_eq!(chunk.len() as u64, size);
        // 收满即终验：缓存入账、预留转正、tmp 已 rename
        assert!(ctx.cache.lookup(key).is_some(), "收满即终验入缓存（不等 EOF）");
        assert_eq!(ctx.cache.total(), size);
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "commit 后 inflight 归零");
        assert_tmp_empty(&root);
        // 核心断言：finish 后再 poll 立即 None——上游 Pending 也绝不能挂住状态机
        let again = tokio::time::timeout(std::time::Duration::from_millis(500), st.next_chunk()).await;
        assert!(
            matches!(again, Ok(None)),
            "finish 后再 poll 必须立即返回 None（不得等待上游 EOF）：{again:?}"
        );
        drop(st);
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "锁表必须随 Drop 摘除");
        assert_eq!(ctx.cache.total(), size, "commit 入账不受 Drop 影响");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r7 P1-4：透传流半途被丢弃（客户端断连）→ Drop 收口标 poisoned（内存流直喂）
    #[tokio::test]
    async fn hashed_stream_drop_mid_stream_poisons() {
        let (ctx, root) = test_ctx("hashed-drop").await;
        let key = "x/2020-01/hasheddrop.jpg";
        {
            let mut stream = HashedStream {
                inner: Box::pin(futures_util::stream::iter(vec![Ok(bytes::Bytes::from(vec![
                    b'x';
                    100
                ]))])),
                state: Some((
                    Sha256::new(),
                    sha256_hex(b"whatever"),
                    key.to_owned(),
                    ctx.cache.clone(),
                    0,
                    500,
                )),
            };
            use futures_util::StreamExt;
            assert!(stream.next().await.is_some(), "第一块正常送达");
            // 半途丢弃：未收满、无错误、无 EOF——Drop 兜底
        }
        assert!(ctx.cache.is_poisoned(key), "半途丢弃必须由 Drop 标 poisoned");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-9：透传流 received 超 expect → poisoned + 流终止（内存流直喂）
    #[tokio::test]
    async fn hashed_stream_over_length_poisons() {
        let (ctx, root) = test_ctx("hashed-over").await;
        let key = "x/2020-01/over.jpg";
        let make_chunk = || -> Result<bytes::Bytes, BoxError> {
            Ok(bytes::Bytes::from(vec![b'x'; 300]))
        };
        let mut stream = HashedStream {
            inner: Box::pin(futures_util::stream::iter(vec![make_chunk(), make_chunk()])),
            state: Some((
                Sha256::new(),
                sha256_hex(b"whatever"),
                key.to_owned(),
                ctx.cache.clone(),
                0,
                500,
            )),
        };
        use futures_util::StreamExt;
        let first = stream.next().await.expect("第一块应正常送达");
        assert!(first.is_ok());
        let second = stream.next().await.expect("超长块应以错误终止");
        assert!(second.is_err(), "超长必须终止流");
        assert!(ctx.cache.is_poisoned(key), "超长必须标 poisoned");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- r6 P1-4：206 Content-Range 完整解析（denominator /total 必须合法且与卷一致） ----

    #[tokio::test]
    async fn object_fetch_206_wrong_total_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-514/4096".to_owned(),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-wrong-total").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("total 与卷尺寸不符必须拒绝");
        assert!(matches!(err, FetchError::Integrity(ref m) if m.contains("total")), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_missing_denominator_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-514".to_owned(),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-no-total").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("缺 denominator 必须拒绝");
        assert!(matches!(err, FetchError::Integrity(ref m) if m.contains("total")), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_star_total_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-514/*".to_owned(),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-star-total").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("通配 total 必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn object_fetch_206_nonnumeric_total_rejected() {
        let body = b"abc".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-514/2O48".to_owned(),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = test_ctx("fetch-bad-total").await;
        let obj = test_obj(b"abc");
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("非数值 total 必须拒绝");
        assert!(matches!(err, FetchError::Integrity(_)), "{err:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- r6 P1-8：零字节对象拒绝回源（不发请求） ----

    #[tokio::test]
    async fn object_fetch_zero_byte_object_rejected_without_request() {
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            "bytes 512-512/2048".to_owned(),
            b"x".to_vec(),
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = test_ctx("fetch-zero").await;
        let mut obj = test_obj(b"abc");
        obj.size = 0;
        let url = format!("http://{addr}/repos/test/cdn-media.test/releases/assets/42");
        let err = object_fetch(&ctx.http, "", &url, &obj, None, 2048)
            .await
            .expect_err("零字节对象必须拒绝回源");
        assert!(matches!(err, FetchError::Integrity(ref m) if m.contains("零字节")), "{err:?}");
        assert_eq!(st.lock().unwrap().hits(), 0, "零字节不得发出任何上游请求");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- r6 P0-1 / P1-7：serve 全链路（注入索引 + raw TCP mock 上游） ----

    /// 注入完整索引的测试上下文（handler 全链路：serve() 直调）；
    /// `large_object` = 透传阈值（压小可强制对象走 pass_through）
    async fn serve_ctx(
        name: &str,
        large_object: u64,
    ) -> (Arc<MediaCtx>, std::path::PathBuf) {
        let cache_root =
            std::env::temp_dir().join(format!("cdn-media-serve-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache_root);
        let cfg = Arc::new(crate::test_support::test_config_with_threshold(
            "http://127.0.0.1:9/manifest/current.json".to_owned(),
            cache_root.display().to_string(),
            large_object,
        ));
        let manifest = Arc::new(ManifestSource::new(cfg.clone()));
        let cache = Arc::new(
            DiskCache::recover(&cache_root, cfg.cache.high_bytes, cfg.cache.low_bytes, &HashSet::new())
                .unwrap(),
        );
        let ctx = Arc::new(MediaCtx {
            cfg,
            manifest,
            cache,
            http: MediaCtx::new_client(),
            warm_gate: Arc::new(tokio::sync::Semaphore::new(crate::admin::WARM_CONCURRENCY)),
        });
        (ctx, cache_root)
    }

    fn get_req(key: &str, range: Option<&str>) -> Request<Body> {
        let mut b = Request::builder()
            .method(Method::GET)
            .uri(format!("/cdn-media/{key}"));
        if let Some(r) = range {
            b = b.header(header::RANGE, r);
        }
        b.body(Body::empty()).expect("request")
    }

    fn serve_obj(body: &[u8], key: &str) -> (String, MediaObject) {
        (
            key.to_owned(),
            MediaObject {
                volume: VOLUME.to_owned(),
                offset: 512,
                size: body.len() as u64,
                sha256: sha256_hex(body),
                content_type: "image/jpeg".to_owned(),
            },
        )
    }

    /// 把 (key → object) 表注入 ctx 的 manifest 源（跳过 HTTP 拉取）
    async fn inject_index(ctx: &Arc<MediaCtx>, objects: Vec<(String, MediaObject)>, url_base: String) {
        let idx = ManifestIndex::new_for_test_full(
            1,
            objects.into_iter().collect(),
            HashMap::from([(VOLUME.to_owned(), 42u64)]),
            HashMap::from([(VOLUME.to_owned(), 2048u64)]),
            url_base,
        );
        ctx.manifest.set_index_for_test(idx).await;
    }

    async fn body_bytes(resp: Response) -> Result<bytes::Bytes, axum::Error> {
        axum::body::to_bytes(resp.into_body(), usize::MAX).await
    }

    /// r6 P0-1：普通 GET 并发同 key miss——只有一个回源者；全程恰好一次 upstream
    /// 命中、一次成功 commit；成功后无 reservation/tmp/lock-table 泄漏
    #[tokio::test]
    async fn serve_tee_concurrent_miss_single_flight_single_fetch() {
        let body = b"serve-flight-payload".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body.clone(),
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = serve_ctx("flight-ok", 1_000_000).await;
        let key = "x/2020-01/flight.jpg";
        inject_index(&ctx, vec![serve_obj(&body, key)], format!("http://{addr}")).await;

        // 顺序驱动（不能 join 两个 serve——后到者要等先到者 body 消费完才放锁，
        // join 会形成「等锁 ↔ 等 body」死锁）：先取 A 的响应（持锁 streaming），
        // 再起 B（应阻塞在锁上），消费 A body 触发 commit + 放锁，B 才完成
        let ctx_a = ctx.clone();
        let ta = tokio::spawn(async move { serve(State(ctx_a), get_req(key, None)).await });
        let ra = ta.await.expect("A task") ;
        assert_eq!(ra.status(), StatusCode::OK);
        let ctx_b = ctx.clone();
        let tb = tokio::spawn(async move { serve(State(ctx_b), get_req(key, None)).await });
        // B 此刻应阻塞在 flight 锁上：尚未回源
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(st.lock().unwrap().hits(), 1, "B 必须仍在等锁（不得提前回源）");
        // 消费 A body → finish/commit → 守卫随流结束释放
        let ba = body_bytes(ra).await.expect("A body 完整");
        let rb = tb.await.expect("B task");
        assert_eq!(rb.status(), StatusCode::OK);
        let bb = body_bytes(rb).await.expect("B body 完整");
        assert!(
            &ba[..] == body.as_slice() && &bb[..] == body.as_slice(),
            "两个响应都必须送达完整对象字节"
        );
        assert_eq!(st.lock().unwrap().hits(), 1, "并发同 key miss 只允许一次回源");
        assert!(ctx.cache.lookup(key).is_some(), "校验通过必须入缓存");
        assert_eq!(ctx.cache.total(), body.len() as u64, "恰好成功 commit 一次");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "无 reservation 泄漏");
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "锁表必须最终清理");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r6 P0-1：并发失败路径——先到者 tee 流毕 sha 失败标 poisoned；后到者等锁后
    /// 看到 poisoned 落入透传（第二次回源）；终态无泄漏
    #[tokio::test]
    async fn serve_tee_concurrent_failure_no_reservation_or_lock_leak() {
        let expect = b"expected-concurrent-bytes";
        let bad = vec![b'X'; expect.len()];
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + bad.len() - 1),
            bad.clone(),
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = serve_ctx("flight-bad", 1_000_000).await;
        let key = "x/2020-01/flightbad.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        // 顺序驱动（同上：后到者等锁依赖先到者 body 消费完毕）
        let ctx_a = ctx.clone();
        let ta = tokio::spawn(async move { serve(State(ctx_a), get_req(key, None)).await });
        let ra = ta.await.expect("A task");
        let ctx_b = ctx.clone();
        let tb = tokio::spawn(async move { serve(State(ctx_b), get_req(key, None)).await });
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(st.lock().unwrap().hits(), 1, "B 必须仍在等锁");
        // A body 消费完 → 流毕 sha 失败 → poisoned + 放锁；B 等锁后见 poisoned → 透传
        let ba = body_bytes(ra).await;
        let rb = tb.await.expect("B task");
        let bb = body_bytes(rb).await;
        assert!(
            matches!(ba.as_ref(), Ok(b) if &b[..] == bad.as_slice())
                || matches!(bb.as_ref(), Ok(b) if &b[..] == bad.as_slice()),
            "至少一个响应如实送达完整上游字节（坏字节也要转发给客户端）"
        );
        assert_eq!(st.lock().unwrap().hits(), 2, "失败路径：tee 一次 + 透传一次");
        assert!(ctx.cache.lookup(key).is_none(), "坏数据不得入缓存");
        assert!(ctx.cache.is_poisoned(key), "必须标 poisoned");
        assert_eq!(ctx.cache.total(), 0, "不得有任何入账");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "失败/断连后 inflight 必须归零");
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "锁表必须最终清理");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r6 P0-1：客户端断连（响应体未消费即丢弃）——TeeState Drop 兜底：归还预留、
    /// 删临时文件、标 poisoned、释放锁
    #[tokio::test]
    async fn serve_tee_disconnect_cleans_reservation_tmp_and_lock_table() {
        let body = b"disconnect-payload-bytes".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("flight-drop", 1_000_000).await;
        let key = "x/2020-01/disconnect.jpg";
        inject_index(&ctx, vec![serve_obj(b"disconnect-payload-bytes", key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        // 断连 = 客户端不消费 body 直接丢弃 → 流状态机 Drop 兜底
        drop(resp);
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "断连必须归还预留");
        assert!(ctx.cache.lookup(key).is_none(), "断连不得入缓存");
        assert!(ctx.cache.is_poisoned(key), "断连的半截流必须标 poisoned");
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "断连必须释放锁并摘表");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    // ---- r6 P1-7：真实 HTTP framing（声明 CL 与实际 body 不一致）全链路 ----

    /// tee 全链路：上游声明 CL = size+5（与请求区间不符）——头校验层（206 精确
    /// 校验）即拒绝 → Integrity → 502 + poisoned，坏 framing 不得进入流阶段
    #[tokio::test]
    async fn serve_tee_upstream_content_length_lie_returns_502_and_poisons() {
        let expect = b"framing-overlong-payload";
        let mut lying = expect.to_vec();
        lying.extend_from_slice(b"EXTRA");
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some(format!("bytes 512-{}/2048", 512 + lying.len() - 1)),
            content_length: Some(lying.len().to_string()),
            body: lying,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("frame-tee-over", 1_000_000).await;
        let key = "x/2020-01/framingover.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY, "CL 与请求不符必须 502");
        assert!(ctx.cache.lookup(key).is_none(), "越界不得入缓存");
        assert!(ctx.cache.is_poisoned(key), "Integrity 失败必须标 poisoned");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "失败后预留必须归还");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// tee 全链路（真实 framing 截断）：上游诚实声明 CL = size 但多发 5 字节——
    /// hyper 在 framing 层截断到 CL，应用层恰好收到 size 字节且 sha 对账通过 →
    /// 正常入缓存；多出的尾流绝不进入缓存（r6 P1-7：framing 截断路径可观测）
    #[tokio::test]
    async fn serve_tee_framing_truncates_long_body_to_content_length() {
        let expect = b"framing-truncate-payload";
        let mut long_body = expect.to_vec();
        long_body.extend_from_slice(b"JUNK5");
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some(format!("bytes 512-{}/2048", 512 + expect.len() - 1)),
            content_length: Some(expect.len().to_string()),
            body: long_body,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = serve_ctx("frame-tee-trunc", 1_000_000).await;
        let key = "x/2020-01/framingtrunc.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let got = body_bytes(resp).await.expect("framing 截断后必须完整送达 CL 字节");
        assert_eq!(&got[..], &expect[..], "客户端只能收到 CL 声明的字节数");
        assert!(ctx.cache.lookup(key).is_some(), "sha 对账通过必须入缓存");
        assert!(!ctx.cache.is_poisoned(key));
        assert_eq!(st.lock().unwrap().hits(), 1);
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// tee 全链路（r7 P1-4 真实 framing 短 EOF）：头诚实声明对象完整的
    /// Content-Range/Content-Length（validate_upstream_206 放行进入流阶段），
    /// socket 实际少发 3 字节后断开——reqwest body 以错误终止 → abort →
    /// poisoned；无缓存、无 tmp、预留归还、锁表清理。此前用例把 CL/CR 一并写成
    /// 截短值，在头校验层即被拦截，从未测到 framing 路径。
    #[tokio::test]
    async fn serve_tee_framing_short_content_length_poisons() {
        let expect = b"framing-short-payload-bytes";
        let truncated = expect[..expect.len() - 3].to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            // 头诚实：完整区间 + 完整 CL
            content_range: Some(format!("bytes 512-{}/2048", 512 + expect.len() - 1)),
            content_length: Some(expect.len().to_string()),
            // socket 实际少发 3 字节
            body: truncated,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("frame-tee-short", 1_000_000).await;
        let key = "x/2020-01/framingshort.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        let got = body_bytes(resp).await;
        // 客户端被承诺 size 字节但流在 size-3 处以错误终止：绝不静默成功
        assert!(
            got.is_err() || got.as_ref().expect("err 情形之外必有 body").len() != expect.len(),
            "短长流不得伪装成完整响应"
        );
        assert!(ctx.cache.lookup(key).is_none(), "提前断流不得入缓存");
        assert!(ctx.cache.is_poisoned(key), "提前断流必须标 poisoned");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "断流后预留必须归还");
        assert_eq!(ctx.cache.inflight_locks_len(), 0, "断流后锁表必须清理");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// pass_through 全链路（小透传阈值）：上游声明 CL = size+4（与请求区间不符）
    /// → 头校验层拒绝 → Integrity → 502 + poisoned（透传同样不得放过坏 framing）
    #[tokio::test]
    async fn serve_pass_through_upstream_content_length_lie_returns_502_and_poisons() {
        let expect = b"pass-through-overlong";
        let mut lying = expect.to_vec();
        lying.extend_from_slice(b"JUNK");
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some(format!("bytes 512-{}/2048", 512 + lying.len() - 1)),
            content_length: Some(lying.len().to_string()),
            body: lying,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("frame-pt-over", 8).await;
        let key = "x/2020-01/ptover.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY, "CL 与请求不符必须 502");
        assert!(ctx.cache.lookup(key).is_none());
        assert!(ctx.cache.is_poisoned(key), "透传 Integrity 失败必须标 poisoned");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "透传不占用预留");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// pass_through 全链路（真实 framing 截断）：诚实 CL = size 但多发尾流——
    /// hyper 截断到 CL，透传恰好送达 size 字节，不缓存（透传本就不落盘）
    #[tokio::test]
    async fn serve_pass_through_framing_truncates_long_body_to_content_length() {
        let expect = b"pass-through-truncate";
        let mut long_body = expect.to_vec();
        long_body.extend_from_slice(b"ZZZZZ");
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            content_range: Some(format!("bytes 512-{}/2048", 512 + expect.len() - 1)),
            content_length: Some(expect.len().to_string()),
            body: long_body,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("frame-pt-trunc", 8).await;
        let key = "x/2020-01/pttrunc.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let got = body_bytes(resp).await.expect("透传必须送达 CL 字节");
        assert_eq!(&got[..], &expect[..], "透传只能送达 CL 声明的字节数");
        assert!(ctx.cache.lookup(key).is_none(), "透传不落盘");
        assert!(!ctx.cache.is_poisoned(key), "诚实 CL + 前缀一致不得误标 poisoned");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// pass_through 全链路（r7 P1-4 真实 framing 短 EOF）：头诚实声明完整
    /// Content-Range/Content-Length，socket 实际少发 2 字节后断开——reqwest body
    /// 报错 → HashedStream Err 分支收口标 poisoned；缓存无残留
    #[tokio::test]
    async fn serve_pass_through_framing_short_poisons() {
        let expect = b"pass-through-short-body";
        let truncated = expect[..expect.len() - 2].to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 206,
            // 头诚实：完整区间 + 完整 CL
            content_range: Some(format!("bytes 512-{}/2048", 512 + expect.len() - 1)),
            content_length: Some(expect.len().to_string()),
            // socket 实际少发 2 字节
            body: truncated,
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("frame-pt-short", 8).await;
        let key = "x/2020-01/ptshort.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        let got = body_bytes(resp).await;
        assert!(
            got.is_err() || got.as_ref().expect("err 情形之外必有 body").len() != expect.len(),
            "透传短长流不得伪装成完整响应"
        );
        assert!(ctx.cache.is_poisoned(key), "透传提前断流必须标 poisoned");
        assert!(ctx.cache.lookup(key).is_none());
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "透传不占用预留");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r7 P1-4：pass-through 客户端中途断开（响应体未消费完即被丢弃）——
    /// HashedStream Drop 收口标 poisoned：半截透传绝不当作成功放行；
    /// 透传无预留无 tmp，缓存无残留
    #[tokio::test]
    async fn serve_pass_through_disconnect_mid_stream_poisons() {
        let body = b"pass-through-disconnect-payload".to_vec();
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + body.len() - 1),
            body,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("pt-disconnect", 8).await;
        let key = "x/2020-01/ptdisconnect.jpg";
        inject_index(
            &ctx,
            vec![serve_obj(b"pass-through-disconnect-payload", key)],
            format!("http://{addr}"),
        )
        .await;

        let resp = serve(State(ctx.clone()), get_req(key, None)).await;
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        // 客户端断连 = 不消费 body 直接丢弃 → HashedStream Drop 收口
        drop(resp);
        assert!(ctx.cache.is_poisoned(key), "半截透传必须由 Drop 收口标 poisoned");
        assert!(ctx.cache.lookup(key).is_none(), "透传不得入缓存");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "透传不占用预留");
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }

    /// Range miss 全链路：上游 206 的 Content-Length 与请求不符 → Integrity →
    /// 502 + poisoned（validate_upstream_206 在真实 handler 链路生效）
    #[tokio::test]
    async fn serve_range_miss_upstream_lie_returns_502_and_poisons() {
        let expect = b"range-miss-payload";
        let wrong = vec![b'Y'; expect.len() - 1];
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + wrong.len() - 1),
            wrong,
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = serve_ctx("range-lie", 1_000_000).await;
        let key = "x/2020-01/rangelie.jpg";
        inject_index(&ctx, vec![serve_obj(expect, key)], format!("http://{addr}")).await;

        let resp = serve(State(ctx.clone()), get_req(key, Some("bytes=0-4"))).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY, "上游 206 与请求不符必须 502");
        assert!(ctx.cache.is_poisoned(key), "Integrity 失败必须标 poisoned");
        assert!(ctx.cache.lookup(key).is_none());
        assert_eq!(ctx.cache.stats().inflight_reserved, 0);
        assert_tmp_empty(&root);
        std::fs::remove_dir_all(&root).ok();
    }
}
