//! `/cdn-media/:source/*` handler（A4 媒体 HTTP 语义 + R3 有界拉穿缓存分层）。
//!
//! 路由挂在无中间件的外层 Router 上：结构性绕过全局 CompressionLayer 与通用
//! no-cache 头（8080 主路由改造见 main.rs）。
//!
//! 分层决策（对每个 miss）：
//! - size ≤ large_object_bytes（默认 50MB）或 pinned → 入缓存路径。无 Range 时
//!   stream-through：tee 临时文件流式回客户端（immutable 头），流毕校验 sha256
//!   通过才原子 rename 入缓存，失败标 poisoned 拒缓存；有 Range 时整对象取回
//!   校验入缓存后本地伺服 206/416
//! - 超阈值 / 超水位 / poisoned / 腾位失败 → 透传不落盘：边传边 hash（整对象），
//!   失败标 poisoned；响应头无缓存承诺（R3：no-store，客户端重试即得正确副本），
//!   Range 透传把上游卷坐标改写为对象坐标的 Content-Range
//!
//! 响应头（命中/入缓存路径）：Cache-Control: public, max-age=31536000, immutable、
//! Accept-Ranges: bytes、Content-Type（manifest content_type）、精确 Content-Length。
//! HEAD miss 不回源，用 manifest 元数据合成 200。

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

    if cacheable {
        // single-flight：并发同 key miss 只有一个回源者，其余等锁后重查缓存
        let gate = ctx.cache.lock_key(&canonical).await;
        let _guard = gate.lock().await;
        if let Some(path) = ctx.cache.lookup(&canonical) {
            return serve_local(&path, obj.size, &obj.content_type, &range).await;
        }
        if !ctx.cache.is_poisoned(&canonical) && ctx.cache.make_room(obj.size, &canonical) {
            if range == RangeSpec::None {
                return stream_through_tee(&ctx, &index, &canonical, &obj, pinned).await;
            }
            // Range miss：整对象取回校验入缓存后本地伺服 206/416
            match fetch_object_to_cache(&ctx, &index, &canonical, &obj, pinned).await {
                Ok(path) => return serve_local(&path, obj.size, &obj.content_type, &range).await,
                Err(e) => {
                    eprintln!("[cdn-media] 取回失败 {canonical}：{e}");
                    return err_json(StatusCode::BAD_GATEWAY, "upstream_error", Some(&canonical));
                }
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

/// stream-through（≤阈值 miss、无 Range）：tee 临时文件流式回客户端，
/// 流毕校验 sha256 → 原子 rename 入缓存；失败标 poisoned、临时文件丢弃
async fn stream_through_tee(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
) -> Response {
    let Some(url) = index.object_url(&ctx.cfg.github.repo, obj) else {
        return err_json(StatusCode::BAD_GATEWAY, "volume_unresolved", Some(key));
    };
    let tmp = ctx.cache.new_tmp_path(key);
    let file = match tokio::fs::File::create(&tmp).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[cdn-media] 临时文件创建失败 {}：{e}", tmp.display());
            ctx.cache.mark_poisoned(key);
            return err_json(StatusCode::BAD_GATEWAY, "cache_io_error", Some(key));
        }
    };
    let resp = match object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, None).await {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
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
        done: false,
    };
    let body = Body::from_stream(futures_util::stream::unfold(state, |mut st| async move {
        match st.upstream.next().await {
            Some(Ok(chunk)) => {
                st.hasher.update(&chunk);
                if let Some(f) = st.file.as_mut() {
                    if let Err(e) = f.write_all(&chunk).await {
                        st.abort("临时文件写入失败", &e.to_string()).await;
                        return Some((Err(Box::new(e) as BoxError), st));
                    }
                }
                st.written += chunk.len() as u64;
                // 关键：不能等流 EOF（None）才终验——hyper 发满 Content-Length 后
                // 不再轮询 body，Drop 兜底会把临时文件当失败清理。对象长度在
                // manifest 里是已知常量，收满即终验+入缓存。
                if st.written == st.size {
                    st.finish().await;
                } else if st.written > st.size {
                    st.abort("上游超长", &format!("written={} expect={}", st.written, st.size))
                        .await;
                    return Some((Err("upstream over-length".into()) as Result<bytes::Bytes, BoxError>, st));
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
    // 头部先行（immutable；流毕才校验——失败仅服务端拒缓存并标 poisoned）
    let mut resp = Response::new(body);
    let h = resp.headers_mut();
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(v) = HeaderValue::from_str(&obj.content_type) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(obj.size));
    resp
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// tee 流状态机：Drop 兜底清理临时文件（客户端断连导致流被丢弃时）
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
    done: bool,
}

impl TeeState {
    async fn abort(&mut self, why: &str, detail: &str) {
        self.done = true;
        self.file = None;
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
        if let Some(parent) = self.final_path.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                eprintln!("[cdn-media] 缓存目录创建失败：{e}");
                let _ = std::fs::remove_file(&self.tmp);
                return;
            }
        }
        match tokio::fs::rename(&self.tmp, &self.final_path).await {
            Ok(()) => {
                self.cache.register(&self.key, self.size, self.pinned);
                eprintln!(
                    "[cdn-media] 缓存入账 {key}（{n} 字节）",
                    key = self.key,
                    n = self.size
                );
            }
            Err(e) => {
                eprintln!("[cdn-media] 原子 rename 失败 {}：{e}", self.tmp.display());
                let _ = std::fs::remove_file(&self.tmp);
            }
        }
    }
}

impl Drop for TeeState {
    fn drop(&mut self) {
        if !self.done {
            self.file = None;
            let _ = std::fs::remove_file(&self.tmp);
            self.cache.mark_poisoned(&self.key);
        }
    }
}

fn hex_bytes(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// 整对象取回→校验→入缓存（Range miss / warm 共用）
pub async fn fetch_object_to_cache(
    ctx: &Arc<MediaCtx>,
    index: &Arc<ManifestIndex>,
    key: &str,
    obj: &MediaObject,
    pinned: bool,
) -> Result<std::path::PathBuf, String> {
    let url = index
        .object_url(&ctx.cfg.github.repo, obj)
        .ok_or_else(|| format!("卷未解析：{}", obj.volume))?;
    let tmp = ctx.cache.new_tmp_path(key);
    let fetch = async {
        let resp = object_fetch(&ctx.http, &ctx.cfg.github.token, &url, obj, None).await?;
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("临时文件创建失败：{e}"))?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut stream = resp.bytes_stream();
        while let Some(item) = stream.next().await {
            let chunk = item.map_err(|e| format!("回源流中断：{e}"))?;
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("临时文件写入失败：{e}"))?;
            written += chunk.len() as u64;
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
        Ok(()) => {
            let final_path = ctx.cache.path_for(key);
            if let Some(parent) = final_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("缓存目录创建失败：{e}"))?;
            }
            tokio::fs::rename(&tmp, &final_path)
                .await
                .map_err(|e| format!("rename 失败：{e}"))?;
            ctx.cache.register(key, obj.size, pinned);
            eprintln!("[cdn-media] 缓存入账 {key}（{n} 字节）", n = obj.size);
            Ok(final_path)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            ctx.cache.mark_poisoned(key);
            Err(e)
        }
    }
}

/// 对象字节范围回源：总是携带对象坐标 Range（上游若回 200 = 整卷 → 拒绝，防误拉百 MB 卷）
async fn object_fetch(
    http: &reqwest::Client,
    token: &str,
    url: &str,
    obj: &MediaObject,
    sub_range: Option<(u64, u64)>,
) -> Result<reqwest::Response, String> {
    let (a, b) = sub_range.unwrap_or((0, obj.size.saturating_sub(1)));
    let range_value = format!("bytes={}-{}", obj.offset + a, obj.offset + b);
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
                    return Ok(resp);
                }
                if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::GONE {
                    return Err(format!("asset 已不存在（HTTP {status}，不重试）：{url}"));
                }
                last_err = format!("HTTP {status}（期望 206）");
            }
            Err(e) => {
                last_err = format!("{e}");
            }
        }
    }
    Err(format!("对象回源重试耗尽：{range_value}：{last_err}"))
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
        inner: Box::pin(resp.bytes_stream()),
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
///（响应已出且无缓存承诺，客户端重试即得正确副本）
struct HashedStream {
    inner:
        std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send>>,
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
                if let Some((h, _, _, _, received, expect_size)) = self.state.as_mut() {
                    use sha2::Digest;
                    h.update(&chunk);
                    *received += chunk.len() as u64;
                    if *received == *expect_size {
                        // 收满即终验：hyper 发满 Content-Length 后不再轮询
                        let (h, expect, key, cache, _, _) = self.state.take().unwrap();
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
                std::task::Poll::Ready(Some(Err(Box::new(e))))
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
}
