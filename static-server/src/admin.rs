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
use tokio::sync::Semaphore;

use crate::media::{fetch_object_to_cache, MediaCtx};

/// 单次 warm 请求 key 数上限（A5 限 key）
const WARM_MAX_KEYS: usize = 10_000;
/// warm 并发上限（A5 限并发；速率由并发 + GitHub 单连接自然限住）
const WARM_CONCURRENCY: usize = 4;
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
            let pinned = ctx.cfg.pinned.keys.iter().any(|p| p == k);
            if pinned || o.size <= ctx.cfg.cache.large_object_bytes {
                targets.push((k.clone(), o.clone()));
            }
        }
    } else {
        for k in &body.keys {
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

    let budget = body.max_bytes.unwrap_or(ctx.cfg.cache.high_bytes);
    let cached_bytes = Arc::new(AtomicU64::new(0));
    let counters = WarmCounters::default();
    let sem = Arc::new(Semaphore::new(WARM_CONCURRENCY));
    let mut joins = tokio::task::JoinSet::new();

    for (key, obj) in targets {
        let ctx = ctx.clone();
        let index = index.clone();
        let sem = sem.clone();
        let counters = counters.clone();
        let cached_bytes = cached_bytes.clone();
        let pinned = ctx.cfg.pinned.keys.iter().any(|p| p == &key);
        // 预算前置判定（并发下允许少量越过，总量有界即可）
        if cached_bytes.load(Ordering::Relaxed) + obj.size > budget {
            counters.skipped_budget.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        let key2 = key.clone();
        joins.spawn(async move {
            let _permit = sem.acquire().await;
            if ctx.cache.lookup(&key).is_some() {
                counters.already.fetch_add(1, Ordering::Relaxed);
                return;
            }
            match fetch_object_to_cache(&ctx, &index, &key, &obj, pinned).await {
                Ok(_) => {
                    cached_bytes.fetch_add(obj.size, Ordering::Relaxed);
                    counters.warmed.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    eprintln!("[cdn-media] warm 失败 {key2}：{e}");
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
            "bytes_cached": cached_bytes.load(Ordering::Relaxed),
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
