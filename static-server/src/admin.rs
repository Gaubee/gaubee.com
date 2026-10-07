//! admin listener（A5：容器内 0.0.0.0:8081 第二 listener；compose 只发布宿主
//! 127.0.0.1:8081，外网不可达；scratch 无 shell，宿主/1Panel 脚本经 loopback 调用）。
//!
//! - POST /cdn-media-admin/warm：按 manifest 预取（限 key 数/并发/总量；源白名单
//!   天然成立——只接受 manifest 中存在的 key，不接受任何外部 URL）
//! - GET  /cdn-media-admin/stats：缓存水位与 manifest 状态
//!
//! 公网 8080 上这些路径由 main.rs 显式 404（验收项）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::media::{warm_one, MediaCtx, WarmOutcome};

/// 单次 warm 请求 key 数上限（A5 限 key）
pub(crate) const WARM_MAX_KEYS: usize = 10_000;
/// warm 并发上限（A5 限并发；速率由并发 + GitHub 单连接自然限住）。
/// r6 P1-3：语义升级为**全局**上限——所有 warm 请求共享 MediaCtx.warm_gate，
/// 单请求不再自建独立 semaphore
pub(crate) const WARM_CONCURRENCY: usize = 4;
/// warm 请求体上限
const WARM_BODY_LIMIT: usize = 256 * 1024;

#[derive(Deserialize, Default, Debug)]
struct WarmBody {
    /// 要预热的 canonical media key（缺省 = pinned + 全部 ≤阈值的 manifest 对象，
    /// 按 manifest 顺序）
    #[serde(default)]
    keys: Vec<String>,
    /// 本次预热总量预算（字节；缺省 = cache.high_bytes）
    #[serde(default)]
    max_bytes: Option<u64>,
}

fn check_auth(ctx: &MediaCtx, req: &Request<axum::body::Body>) -> Option<Response> {
    let expect = &ctx.cfg.admin.token;
    if expect.is_empty() {
        return None;
    }
    let got = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match got {
        Some(t) if t == expect => None,
        _ => Some((
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"unauthorized"}"#.to_owned(),
        )
            .into_response()),
    }
}

/// r6 P1-3：warm 字节预算的原子预留（CAS）——「检查+预留」一步完成，并发任务
/// 不可能同时通过检查后各自入账（旧实现 spawn 前读同一计数器，窗口内可全部通过，
/// 实际缓存量越过 max_bytes）。
/// 释放语义：Warmed = 保留（字节已真实入缓存，计入预算）；AlreadyCached / NoRoom /
/// Failed = 归还（未消耗预算）。
fn budget_reserve(used: &AtomicU64, bytes: u64, limit: u64) -> bool {
    let mut cur = used.load(Ordering::Relaxed);
    loop {
        // r6 P1-8：checked——溢出即视为超预算
        let next = match cur.checked_add(bytes) {
            Some(n) if n <= limit => n,
            _ => return false,
        };
        match used.compare_exchange_weak(cur, next, Ordering::SeqCst, Ordering::Relaxed) {
            Ok(_) => return true,
            Err(actual) => cur = actual,
        }
    }
}

fn budget_release(used: &AtomicU64, bytes: u64) {
    let mut cur = used.load(Ordering::Relaxed);
    loop {
        let next = cur.saturating_sub(bytes);
        match used.compare_exchange_weak(cur, next, Ordering::SeqCst, Ordering::Relaxed) {
            Ok(_) => return,
            Err(actual) => cur = actual,
        }
    }
}

pub async fn warm(
    State(ctx): State<Arc<MediaCtx>>,
    req: Request<axum::body::Body>,
) -> Response {
    if let Some(resp) = check_auth(&ctx, &req) {
        return resp;
    }
    let Some(index) = ctx.manifest.get().await else {
        return json_resp(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({"error": "source_unavailable"}),
        );
    };
    let body_bytes = match axum::body::to_bytes(req.into_body(), WARM_BODY_LIMIT).await {
        Ok(b) => b,
        Err(e) => {
            return json_resp(
                StatusCode::BAD_REQUEST,
                serde_json::json!({"error": "bad_body", "detail": e.to_string()}),
            )
        }
    };
    let body: WarmBody = if body_bytes.is_empty() {
        WarmBody::default()
    } else {
        match serde_json::from_slice(&body_bytes) {
            Ok(b) => b,
            Err(e) => {
                return json_resp(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "bad_json", "detail": e.to_string()}),
                )
            }
        }
    };
    if body.keys.len() > WARM_MAX_KEYS {
        return json_resp(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "too_many_keys", "limit": WARM_MAX_KEYS}),
        );
    }
    // key 必须在 manifest 中（源白名单语义：不接受任何外部 URL/key）
    let mut targets: Vec<(String, crate::manifest::MediaObject)> = Vec::new();
    if body.keys.is_empty() {
        for (k, o) in index.objects.iter() {
            let source = k.split('/').next().unwrap_or("");
            // r5 P0-4：默认目标也必须过 sources.allow 与空/非法 key 过滤
            //（manifest 键集不能默认信任为白名单内）
            if !ctx.cfg.sources.allow.iter().any(|s| s == source) {
                continue;
            }
            if crate::config::validate_key(k).is_err() {
                continue;
            }
            let pinned = ctx.cfg.pinned.keys.iter().any(|p| p == k);
            if pinned || o.size <= ctx.cfg.cache.large_object_bytes {
                targets.push((k.clone(), o.clone()));
            }
        }
    } else {
        for k in &body.keys {
            if crate::config::validate_key(k).is_err() {
                return json_resp(
                    StatusCode::BAD_REQUEST,
                    serde_json::json!({"error": "invalid_key", "key": k}),
                );
            }
            match index.lookup(k) {
                Some(o) => {
                    let source = k.split('/').next().unwrap_or("");
                    if !ctx.cfg.sources.allow.iter().any(|s| s == source) {
                        return json_resp(
                            StatusCode::BAD_REQUEST,
                            serde_json::json!({"error": "source_not_allowed", "key": k}),
                        );
                    }
                    targets.push((k.clone(), o.clone()));
                }
                None => {
                    return json_resp(
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({"error": "key_not_in_manifest", "key": k}),
                    );
                }
            }
        }
    }

    // r5 P0-4：warm 预算不得超过 high 水位（缓存配额由 admission 硬保证）
    let budget = body
        .max_bytes
        .unwrap_or(ctx.cfg.cache.high_bytes)
        .min(ctx.cfg.cache.high_bytes);
    // r6 P1-3：预算 = 共享原子预留（budget_reserve/budget_release），在任务内以
    // CAS「检查+预留」原子完成；本请求内所有并发任务共享同一计数器
    let budget_used = Arc::new(AtomicU64::new(0));
    let counters = WarmCounters::default();
    let mut joins = tokio::task::JoinSet::new();

    for (key, obj) in targets {
        let ctx = ctx.clone();
        let index = index.clone();
        let counters = counters.clone();
        let budget_used = budget_used.clone();
        let pinned = ctx.cfg.pinned.keys.iter().any(|p| p == &key);
        // r6 P1-3：计划期预检——已缓存 key 不进任务，天然不占预算/并发闸
        //（并发窗口内被其他请求抢先缓存的 key 仍由 AlreadyCached 释放语义兜底）
        if ctx.cache.lookup(&key).is_some() {
            counters.already.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        joins.spawn(async move {
            // 字节预算原子预留：失败 = 预算已被占满 → skip（不占并发闸）
            if !budget_reserve(&budget_used, obj.size, budget) {
                counters.skipped_budget.fetch_add(1, Ordering::Relaxed);
                return;
            }
            // r6 P1-3：全局并发闸——跨请求共享（旧实现每请求自建 semaphore，
            // N 个并发 warm 请求即 N 倍全局并发）
            let _permit = ctx.warm_gate.acquire().await;
            // r5 P0-4：warm 与 serve 共用 per-key single-flight + admission 预留
            match warm_one(&ctx, &index, &key, &obj, pinned).await {
                WarmOutcome::AlreadyCached => {
                    // 释放语义：未消耗预算（字节并非本次请求写入）
                    budget_release(&budget_used, obj.size);
                    counters.already.fetch_add(1, Ordering::Relaxed);
                }
                WarmOutcome::Warmed => {
                    // 保留语义：字节已真实入缓存，继续计入预算
                    counters.warmed.fetch_add(1, Ordering::Relaxed);
                }
                WarmOutcome::NoRoom => {
                    budget_release(&budget_used, obj.size);
                    counters.skipped_budget.fetch_add(1, Ordering::Relaxed);
                }
                WarmOutcome::Failed(e) => {
                    budget_release(&budget_used, obj.size);
                    eprintln!("[cdn-media] warm 失败 {key}：{e}");
                    counters.failed.fetch_add(1, Ordering::Relaxed);
                }
            }
        });
    }
    while joins.join_next().await.is_some() {}

    json_resp(
        StatusCode::OK,
        serde_json::json!({
            "requested": counters.warmed.load(Ordering::Relaxed)
                + counters.already.load(Ordering::Relaxed)
                + counters.failed.load(Ordering::Relaxed)
                + counters.skipped_budget.load(Ordering::Relaxed),
            "warmed": counters.warmed.load(Ordering::Relaxed),
            "already_cached": counters.already.load(Ordering::Relaxed),
            "failed": counters.failed.load(Ordering::Relaxed),
            "skipped_budget": counters.skipped_budget.load(Ordering::Relaxed),
            "bytes_cached": budget_used.load(Ordering::Relaxed),
        }),
    )
}

#[derive(Clone, Default)]
struct WarmCounters {
    warmed: Arc<AtomicU64>,
    already: Arc<AtomicU64>,
    failed: Arc<AtomicU64>,
    skipped_budget: Arc<AtomicU64>,
}

pub async fn stats(State(ctx): State<Arc<MediaCtx>>) -> Response {
    let s = ctx.cache.stats();
    let info = ctx.manifest.info().await;
    let loaded_at_unix = info
        .as_ref()
        .and_then(|(_, _, t)| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let (gen, objects) = (info.as_ref().map(|(g, _, _)| *g), info.as_ref().map(|(_, o, _)| *o));
    json_resp(
        StatusCode::OK,
        serde_json::json!({
            "cache": {
                "dir": ctx.cfg.cache.dir,
                "objects": s.objects,
                "bytes": s.bytes,
                "high_bytes": s.high,
                "low_bytes": s.low,
                "pinned_objects": s.pinned_objects,
                "pinned_bytes": s.pinned_bytes,
                "poisoned_active": ctx.cache.poisoned_count(),
                "undiscardable": s.undiscardable,
                "inflight_reserved": s.inflight_reserved,
            },
            "manifest": {
                "loaded": gen.is_some(),
                "gen": gen,
                "objects": objects,
                "loaded_at_unix": loaded_at_unix,
                "refresh_interval_secs": ctx.manifest.refresh_interval.as_secs(),
            },
        }),
    )
}

fn json_resp(status: StatusCode, body: serde_json::Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    use crate::manifest::{ManifestIndex, ManifestSource, MediaObject};
    use crate::test_support::{sha256_hex, spawn_object_mock, ObjectMockState};

    const VOLUME: &str = "vol-test.tar";
    const OBJ_BODY: &[u8] = b"warm-object-payload-0123456789"; // 30 字节

    async fn warm_ctx(name: &str) -> (Arc<MediaCtx>, std::path::PathBuf) {
        let cache_root =
            std::env::temp_dir().join(format!("cdn-admin-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache_root);
        let cfg = Arc::new(crate::test_support::test_config_default_cache(
            "http://127.0.0.1:9/manifest/current.json".to_owned(),
            cache_root.display().to_string(),
        ));
        let manifest = Arc::new(ManifestSource::new(cfg.clone()));
        let cache = Arc::new(
            crate::cache::DiskCache::recover(
                &cache_root,
                cfg.cache.high_bytes,
                cfg.cache.low_bytes,
                &HashSet::new(),
            )
            .unwrap(),
        );
        let ctx = Arc::new(MediaCtx {
            cfg,
            manifest,
            cache,
            http: MediaCtx::new_client(),
            warm_gate: Arc::new(tokio::sync::Semaphore::new(WARM_CONCURRENCY)),
        });
        (ctx, cache_root)
    }

    fn obj() -> MediaObject {
        MediaObject {
            volume: VOLUME.to_owned(),
            offset: 512,
            size: OBJ_BODY.len() as u64,
            sha256: sha256_hex(OBJ_BODY),
            content_type: "image/jpeg".to_owned(),
        }
    }

    async fn inject(ctx: &Arc<MediaCtx>, keys: &[&str], url_base: String) {
        let objects: HashMap<String, MediaObject> =
            keys.iter().map(|k| (k.to_string(), obj())).collect();
        let idx = ManifestIndex::new_for_test_full(
            1,
            objects,
            HashMap::from([(VOLUME.to_owned(), 42u64)]),
            HashMap::from([(VOLUME.to_owned(), 2048u64)]),
            url_base,
        );
        ctx.manifest.set_index_for_test(idx).await;
    }

    async fn warm_req(ctx: &Arc<MediaCtx>, keys: &[&str], max_bytes: Option<u64>) -> serde_json::Value {
        let body = serde_json::json!({
            "keys": keys,
            "max_bytes": max_bytes,
        });
        let req = Request::builder()
            .method(axum::http::Method::POST)
            .uri("/cdn-media-admin/warm")
            .header(header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(body.to_string()))
            .expect("request");
        let resp = warm(State(ctx.clone()), req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .expect("body");
        serde_json::from_slice(&bytes).expect("json")
    }

    /// r6 P1-3：4 key 并发越过预算——CAS 原子预留下恰好放行 floor(budget/size) 个，
    /// bytes_cached 恰为预算内值，绝不越过 max_bytes
    #[tokio::test]
    async fn warm_budget_atomic_reservation_never_exceeds() {
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + OBJ_BODY.len() - 1),
            OBJ_BODY.to_vec(),
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = warm_ctx("budget").await;
        let keys: Vec<String> = (0..4).map(|i| format!("x/2020-01/warm{i}.jpg")).collect();
        let key_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        inject(&ctx, &key_refs, format!("http://{addr}")).await;

        // 预算 = 100，单对象 30：CAS 预留下最多 floor(100/30)=3 个可过（3×30=90 ≤ 100），
        // 第 4 个必被拒——旧实现（spawn 前各读一次计数器）4 个可同时通过
        let r = warm_req(&ctx, &key_refs, Some(100)).await;
        assert_eq!(r["warmed"], 3, "恰好 3 个过预算：{r}");
        assert_eq!(r["skipped_budget"], 1, "{r}");
        assert_eq!(r["bytes_cached"], 90, "{r}");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "终态无预留泄漏");
        assert_eq!(ctx.cache.total(), 90);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r6 P1-3：已缓存 key 不占预算（计划期预检 + AlreadyCached 释放语义）——
    /// 4 key 中 1 个已缓存，预算恰好容纳其余 3 个：全部成功、零 skip
    #[tokio::test]
    async fn warm_budget_released_on_already_cached() {
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + OBJ_BODY.len() - 1),
            OBJ_BODY.to_vec(),
        )));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = warm_ctx("budget-release").await;
        let keys: Vec<String> = (0..4).map(|i| format!("x/2020-01/rel{i}.jpg")).collect();
        let key_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        inject(&ctx, &key_refs, format!("http://{addr}")).await;

        // 预置第 1 个 key 已缓存（30 字节；目录按缓存布局预建）
        let pre = ctx.cache.admit(&keys[0], OBJ_BODY.len() as u64).unwrap();
        let pre_path = ctx.cache.path_for(&keys[0]);
        std::fs::create_dir_all(pre_path.parent().unwrap()).unwrap();
        std::fs::write(&pre_path, OBJ_BODY).unwrap();
        pre.commit(OBJ_BODY.len() as u64, false);

        // 预算 100：已缓存 key 预检放行（不占预算）；其余 3 个 3×30=90 ≤ 100 全部可入
        let r = warm_req(&ctx, &key_refs, Some(100)).await;
        assert_eq!(r["already_cached"], 1, "{r}");
        assert_eq!(r["warmed"], 3, "{r}");
        assert_eq!(r["skipped_budget"], 0, "已缓存 key 不得消耗预算：{r}");
        assert_eq!(r["bytes_cached"], 90, "{r}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r6 P1-3：budget_reserve/budget_release 纯函数矩阵——CAS 原子性、上界拒绝、
    /// 释放后可再预留、释放不回绕
    #[test]
    fn budget_reserve_release_matrix() {
        let used = AtomicU64::new(0);
        assert!(budget_reserve(&used, 30, 100));
        assert_eq!(used.load(Ordering::SeqCst), 30);
        assert!(budget_reserve(&used, 30, 100));
        assert!(budget_reserve(&used, 30, 100));
        assert_eq!(used.load(Ordering::SeqCst), 90);
        // 90 + 30 = 120 > 100 → 拒绝（检查+预留原子完成）
        assert!(!budget_reserve(&used, 30, 100));
        assert_eq!(used.load(Ordering::SeqCst), 90, "失败的预留不得改变计数");
        // 释放语义：归还后可再预留
        budget_release(&used, 30);
        assert_eq!(used.load(Ordering::SeqCst), 60);
        assert!(budget_reserve(&used, 30, 100));
        // 恰好到界
        assert!(budget_reserve(&used, 10, 100));
        assert_eq!(used.load(Ordering::SeqCst), 100);
        assert!(!budget_reserve(&used, 1, 100), "恰好满界后再预留必须拒绝");
        // 溢出防护
        let huge = AtomicU64::new(u64::MAX - 5);
        assert!(!budget_reserve(&huge, 10, u64::MAX), "checked 溢出必须拒绝");
        // 释放不回绕（过度释放饱和到 0）
        budget_release(&used, 500);
        assert_eq!(used.load(Ordering::SeqCst), 0);
    }

    /// r6 P1-3：全局并发上限跨请求共享——两个并发 warm 请求合计在途连接数
    /// 不超过 WARM_CONCURRENCY（旧实现每请求自建 semaphore，可达 2 倍）
    #[tokio::test]
    async fn warm_global_gate_shared_across_requests() {
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState::ok_206(
            format!("bytes 512-{}/2048", 512 + OBJ_BODY.len() - 1),
            OBJ_BODY.to_vec(),
        )));
        let addr = spawn_object_mock(st.clone()).await;
        let (ctx, root) = warm_ctx("global-gate").await;
        let keys: Vec<String> = (0..8).map(|i| format!("x/2020-01/gate{i}.jpg")).collect();
        let key_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        inject(&ctx, &key_refs, format!("http://{addr}")).await;

        let (ra, rb) = tokio::join!(
            warm_req(&ctx, &key_refs[..4], None),
            warm_req(&ctx, &key_refs[4..], None),
        );
        for r in [&ra, &rb] {
            assert_eq!(r["failed"], 0, "全部必须成功：{r:?}");
        }
        let max_inflight = st.lock().unwrap().max_inflight.load(Ordering::SeqCst);
        assert!(
            max_inflight <= WARM_CONCURRENCY,
            "两个请求共享全局闸：在途 {max_inflight} 不得超过 {WARM_CONCURRENCY}"
        );
        assert_eq!(ra["warmed"], 4);
        assert_eq!(rb["warmed"], 4);
        assert_eq!(ctx.cache.total(), (OBJ_BODY.len() * 8) as u64);
        std::fs::remove_dir_all(&root).ok();
    }

    /// r6 P1-3：失败/NoRoom 释放语义——上游失败后预算归还（统计口径可观测）
    #[tokio::test]
    async fn warm_budget_released_on_failure() {
        // 上游 500 → object_fetch 重试耗尽 → Failed
        let st = Arc::new(std::sync::Mutex::new(ObjectMockState {
            status: 500,
            content_range: None,
            content_length: Some("0".to_owned()),
            body: Vec::new(),
            ..Default::default()
        }));
        let addr = spawn_object_mock(st).await;
        let (ctx, root) = warm_ctx("budget-fail").await;
        let keys: Vec<String> = (0..3).map(|i| format!("x/2020-01/fail{i}.jpg")).collect();
        let key_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
        inject(&ctx, &key_refs, format!("http://{addr}")).await;

        let r = warm_req(&ctx, &key_refs, Some(1000)).await;
        assert_eq!(r["failed"], 3, "{r}");
        assert_eq!(r["bytes_cached"], 0, "失败必须释放全部预留：{r}");
        assert_eq!(ctx.cache.stats().inflight_reserved, 0, "admission 预留同步归还");
        std::fs::remove_dir_all(&root).ok();
    }
}
