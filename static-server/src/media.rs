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
        // single-flight（r5 P0-4）：并发同 key miss 只有一个回源者，其余等锁后重查缓存；
        // lock_key 返回持有型守卫（await 后独占持锁，释放即摘表）
        let _guard = ctx.cache.lock_key(&canonical).await;
        if let Some(path) = ctx.cache.lookup(&canonical) {
            return serve_local(&path, obj.size, &obj.content_type, &range).await;
        }
        if !ctx.cache.is_poisoned(&canonical) {
            // admission 原子预留（r5 P0-4）：预留失败 = 超水位/腾位失败 → 透传
            if let Some(res) = ctx.cache.admit(&canonical, obj.size) {
                // 有 Range 或严格模式：整对象取回校验入缓存后本地伺服 200/206/416
                if range != RangeSpec::None || strict {
                    match fetch_object_to_cache(&ctx, &index, &canonical, &obj, pinned, res).await {
                        Ok(path) => {
                            return serve_local(&path, obj.size, &obj.content_type, &range).await
                        }
                        Err(e) => {
                            eprintln!("[cdn-media] 取回失败 {canonical}：{e}");
                            return err_json(
                                StatusCode::BAD_GATEWAY,
                                "upstream_error",
                                Some(&canonical),
                            );
                        }
                    }
                }
                // 无 Range 非严格：stream-through tee——响应头 no-store（校验通过前
                // 不承诺 immutable，r5 P1-7），流毕校验通过才入缓存
                return stream_through_tee(&ctx, &index, &canonical, &obj, pinned, res).await;
            }
        }
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
/// 不得缓存，失败重试即得正确副本
async fn stream_through_tee(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
    res: crate::cache::Reservation,
) -> Response {
    let Some(url) = index.object_url(&ctx.cfg.github.repo, obj) else {
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
    let resp = match object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, None).await {
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
        upstream: Box::pin(resp.bytes_stream()),
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
    };
    let body = Body::from_stream(futures_util::stream::unfold(state, |mut st| async move {
        match st.upstream.next().await {
            Some(Ok(chunk)) => {
                st.hasher.update(&chunk);
                // r5 P1-9：写盘前 checked 投影——超长/溢出立即中止（删 tmp+poisoned），
                // 绝不把越界字节落到临时文件
                let projected = match st.written.checked_add(chunk.len() as u64) {
                    Some(p) if p <= st.size => p,
                    _ => {
                        st.abort(
                            "上游超长",
                            &format!("written={} chunk={} expect={}", st.written, chunk.len(), st.size),
                        )
                        .await;
                        return Some((Err("upstream over-length".into()), st));
                    }
                };
                if let Some(f) = st.file.as_mut() {
                    if let Err(e) = f.write_all(&chunk).await {
                        st.abort("临时文件写入失败", &e.to_string()).await;
                        return Some((Err(Box::new(e) as BoxError), st));
                    }
                }
                st.written = projected;
                // 关键：不能等流 EOF（None）才终验——hyper 发满 Content-Length 后
                // 不再轮询 body，Drop 兜底会把临时文件当失败清理。对象长度在
                // manifest 里是已知常量，收满即终验+入缓存。
                if st.written == st.size {
                    st.finish().await;
                }
                Some((Ok(chunk), st))
            }
            Some(Err(e)) => {
                st.abort("回源流中断", &e.to_string()).await;
                Some((Err(Box::new(e) as BoxError), st))
            }
            None => {
                // 收满路径已在上面终验；这里处理「上游提前断流」（written < size）
                if !st.done {
                    st.abort(
                        "上游提前断流",
                        &format!("written={}/{}", st.written, st.size),
                    )
                    .await;
                }
                None
            }
        }
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
/// admission 预留随状态机走——finish 转正、abort/Drop 归还（r5 P0-4）
struct TeeState {
    upstream: std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send>>,
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
}

impl TeeState {
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
    let tmp = ctx.cache.new_tmp_path(key);
    let fetch = async {
        let resp =
            object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, None)
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

/// r5 P1-8：精确校验上游 206 的 Content-Range 区间与 Content-Length 与请求一致；
/// 不一致 = Integrity 错误（poisoned + 失败）
fn validate_upstream_206(
    resp: reqwest::Response,
    start: u64,
    end: u64,
    expect_len: u64,
) -> Result<reqwest::Response, FetchError> {
    let integrity = |m: String| FetchError::Integrity(m);
    let cr = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| integrity("206 响应缺 Content-Range".to_owned()))?;
    let expect_prefix = format!("bytes {start}-{end}/");
    if !cr.starts_with(&expect_prefix) {
        return Err(integrity(format!(
            "Content-Range 与请求不一致：got={cr:?} want={expect_prefix:?}*"
        )));
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
/// 206 响应必须通过 Content-Range/Content-Length 精确校验（r5 P1-8）；offset 计算全部
/// checked_add，畸形 manifest 数据不得回绕成错误区间
async fn object_fetch(
    http: &reqwest::Client,
    token: &str,
    url: &str,
    obj: &MediaObject,
    sub_range: Option<(u64, u64)>,
) -> Result<reqwest::Response, FetchError> {
    let (a, b) = sub_range.unwrap_or((0, obj.size.saturating_sub(1)));
    let integrity = |m: String| FetchError::Integrity(m);
    let start = obj
        .offset
        .checked_add(a)
        .ok_or_else(|| integrity(format!("offset 溢出：offset={} + a={a}", obj.offset)))?;
    let end = obj
        .offset
        .checked_add(b)
        .ok_or_else(|| integrity(format!("offset 溢出：offset={} + b={b}", obj.offset)))?;
    let expect_len = b - a + 1;
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
                    return validate_upstream_206(resp, start, end, expect_len);
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
    let sub = match range {
        RangeSpec::None => None,
        RangeSpec::Slice(a, b) => Some((*a, *b)),
        RangeSpec::Unsatisfiable => return not_satisfiable(obj.size),
    };
    let resp = match object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, sub).await {
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
        });
        (ctx, cache_root)
    }

    fn test_index(url_base: &str) -> Arc<ManifestIndex> {
        Arc::new(ManifestIndex::new_for_test(
            1,
            HashMap::from([(VOLUME.to_owned(), 42u64)]),
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
        let resp = object_fetch(&ctx.http, "", &url, &obj, None)
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
        let err = object_fetch(&ctx.http, "", &url, &obj, None)
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
        let err = object_fetch(&ctx.http, "", &url, &obj, None)
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
        let err = object_fetch(&ctx.http, "", &url, &obj, None)
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
        let err = object_fetch(&ctx.http, "", &url, &obj, None)
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
        let resp = stream_through_tee(&ctx, &index, key, &obj, false, res).await;
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
        let resp = stream_through_tee(&ctx, &index, key, &obj, false, res).await;
        assert_eq!(resp.headers().get("cache-control").unwrap(), "no-store");
        let got = axum::body::to_bytes(resp.into_body(), usize::MAX).await.expect("no-store 下坏字节仍如实送达");
        assert_eq!(got.len(), body.len());
        assert!(ctx.cache.lookup(key).is_none(), "校验失败不得入缓存");
        assert!(ctx.cache.is_poisoned(key));
        assert_tmp_empty(&root);
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
}
