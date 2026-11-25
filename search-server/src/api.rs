//! HTTP API：`POST /api/search` 与 `GET /health`（axum）。
//!
//! 查询 embedding 失败/超时（默认 2s）时自动降级为 FTS-only，响应
//! `degraded: true`；客户端契约不变（继续 POST /api/search）。
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::embed::EmbeddingClient;
use crate::search::{dedupe_and_page, normalize_fts_scores, ScoredHit, SearchFilters};
use crate::store::{LoadedIndex, SearchMode};

pub const ENGINE: &str = "sqlite-fts5";

pub struct AppState {
    pub index: LoadedIndex,
    pub embedder: Option<EmbeddingClient>,
    /// 仅当 manifest.model == embedder.model() 时为 true；否则向量空间不可复用。
    pub vector_enabled: bool,
    pub started: Instant,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub q: Option<String>,
    #[serde(default)]
    pub apps: Vec<String>,
    #[serde(default)]
    pub exclude_apps: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResultItem>,
    /// 候选集内按 parentId 去重后的文档数（受 topk 截断，不是全库精确 count）。
    pub total: usize,
    pub took_ms: u128,
    pub engine: &'static str,
    pub degraded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub excerpt: String,
    pub href: String,
    pub date: i64,
    pub score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub engine: &'static str,
    pub embed_model: Option<String>,
    pub embed_configured: bool,
    pub vector_enabled: bool,
    pub index_model: String,
    pub active_model: Option<String>,
    pub embed_dim: usize,
    pub embed_cache_entries: usize,
    pub embed_cache_hits: u64,
    pub embed_cache_misses: u64,
    pub docs: usize,
    pub documents: usize,
    pub chunks: usize,
    pub index_built_at: String,
    pub index: String,
    pub uptime_ms: u128,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/search", post(search_handler))
        .route("/health", get(health_handler))
        .layer(axum::middleware::from_fn(cors))
        .with_state(state)
}

#[derive(Debug)]
enum SearchFailure {
    BadRequest(String),
    Internal(anyhow::Error),
}

impl From<anyhow::Error> for SearchFailure {
    fn from(error: anyhow::Error) -> Self {
        SearchFailure::Internal(error)
    }
}

async fn search_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let state = state.clone();
    let outcome = tokio::task::spawn_blocking(move || run_search(&state, request))
        .await
        .map_err(|error| ApiError::internal(anyhow::anyhow!("搜索任务 panic：{error}")))?;
    match outcome {
        Ok(response) => Ok(Json(response)),
        Err(SearchFailure::BadRequest(message)) => Err(ApiError::bad_request(message)),
        Err(SearchFailure::Internal(error)) => Err(ApiError::internal(error)),
    }
}

fn run_search(state: &AppState, request: SearchRequest) -> Result<SearchResponse, SearchFailure> {
    let started = Instant::now();
    let query = request.q.as_deref().unwrap_or("").trim();
    if query.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            total: 0,
            took_ms: started.elapsed().as_millis(),
            engine: ENGINE,
            degraded: false,
        });
    }
    if query.chars().count() > 256 {
        return Err(SearchFailure::BadRequest(
            "查询过长（最多 256 字）".to_string(),
        ));
    }

    let limit = request.limit.unwrap_or(10).clamp(1, 50);
    let offset = request.offset.unwrap_or(0).min(200);
    let mode = SearchMode::parse(request.mode.as_deref().unwrap_or("hybrid"))
        .map_err(|error| SearchFailure::BadRequest(error.to_string()))?;

    let filters = SearchFilters {
        apps: request.apps,
        exclude_apps: request.exclude_apps,
        tags: request.tags,
        date_from: request.date_from,
        date_to: request.date_to,
    };
    let filters = filters
        .validate()
        .map_err(|error| SearchFailure::BadRequest(error.to_string()))?;

    // 去重要多取候选：每篇最多 8 chunk，按 8 倍扩展并设上下限。
    let fetch_k = ((offset + limit) * 8).clamp(50, 200);

    let mut degraded = false;
    let mut embedding = None;
    if mode != SearchMode::Fts {
        if !state.vector_enabled {
            // 模型与索引不一致（或未配置 key）：禁止使用旧向量，退化为 FTS。
            degraded = true;
        } else if let Some(client) = state.embedder.as_ref() {
            match client.embed_query(query, state.index.dim()) {
                Ok(vector) => embedding = Some(vector),
                Err(error) => {
                    tracing::warn!(%error, "查询 embedding 失败，降级为 FTS-only");
                    degraded = true;
                }
            }
        } else {
            degraded = true;
        }
    }

    let effective_mode = if embedding.is_some() {
        mode
    } else {
        SearchMode::Fts
    };
    let hits = state
        .index
        .search(
            effective_mode,
            embedding.as_deref(),
            query,
            &filters,
            fetch_k,
        )
        .map_err(SearchFailure::Internal)?;

    let mut scored = hits
        .into_iter()
        .map(|hit| ScoredHit::new(hit, effective_mode))
        .collect::<Vec<_>>();
    if effective_mode == SearchMode::Fts {
        normalize_fts_scores(&mut scored);
    }

    let (results, total) = dedupe_and_page(scored, offset, limit);
    Ok(SearchResponse {
        results: results
            .into_iter()
            .map(|result| SearchResultItem {
                id: result.id,
                app_id: result.app_id,
                app_name: result.app_name,
                title: result.title,
                excerpt: result.excerpt,
                href: result.href,
                date: result.date,
                score: (result.score * 10_000.0).round() / 10_000.0,
            })
            .collect(),
        total,
        took_ms: started.elapsed().as_millis(),
        engine: ENGINE,
        degraded,
    })
}

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(health_response(&state))
}

fn health_response(state: &AppState) -> HealthResponse {
    let manifest = state.index.manifest();
    let active_model = state
        .embedder
        .as_ref()
        .map(|client| client.model().to_string());
    let cache = state
        .embedder
        .as_ref()
        .map(|client| client.cache_stats())
        .unwrap_or_default();
    HealthResponse {
        ok: true,
        engine: ENGINE,
        embed_model: active_model.clone(),
        embed_configured: state.embedder.is_some(),
        vector_enabled: state.vector_enabled,
        index_model: manifest.model.clone(),
        active_model,
        embed_dim: state.index.dim(),
        embed_cache_entries: cache.entries,
        embed_cache_hits: cache.hits,
        embed_cache_misses: cache.misses,
        docs: state.index.chunk_count(),
        documents: state.index.document_count(),
        chunks: manifest.chunks,
        index_built_at: manifest.built_at.clone(),
        index: state.index.path().display().to_string(),
        uptime_ms: state.started.elapsed().as_millis(),
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(error: anyhow::Error) -> Self {
        tracing::error!(%error, "搜索服务内部错误");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "搜索服务内部错误".to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message, "engine": ENGINE, "degraded": false })),
        )
            .into_response()
    }
}

/// 公开只读接口的宽松 CORS（本地 vite dev 跨端口调试用）。
async fn cors(request: Request, next: Next) -> Response {
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, GET, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embed::EmbeddingConfig;
    use crate::indexer::{build_index, BuildOptions};
    use crate::test_support::{MockEmbeddingServer, MockMode};
    use std::path::Path;

    fn fixture(root: &Path) {
        std::fs::create_dir_all(root.join("events")).unwrap();
        std::fs::create_dir_all(root.join("articles")).unwrap();
        std::fs::write(
            root.join("events/0001.rust-async.md"),
            "---\ntitle: Rust 异步运行时\ndate: 2024-03-01\ntags:\n  - rust\n---\n\nRust 异步运行时 tokio 与并发调度。\n",
        )
        .unwrap();
        std::fs::write(
            root.join("articles/0002.vector-db.md"),
            "---\ntitle: 向量数据库\ndate: 2024-02-01\ntags:\n  - database\n---\n\n向量数据库 semantic search 与 embedding 检索。\n",
        )
        .unwrap();
    }

    fn config(url: String) -> EmbeddingConfig {
        EmbeddingConfig {
            base_url: url,
            api_key: "test-key".to_string(),
            model: "mock-embed".to_string(),
            timeout: std::time::Duration::from_secs(5),
            batch_size: 2,
            concurrency: 2,
            max_retries: 1,
        }
    }

    fn state_for(url: String) -> (tempfile::TempDir, AppState) {
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        fixture(&content);
        let index_path = directory.path().join("index.sqlite");
        build_index(&BuildOptions {
            content_root: content,
            index_path: index_path.clone(),
            embedding: config(url.clone()),
        })
        .expect("build");
        let index = LoadedIndex::open(&index_path).expect("open");
        let embedder = EmbeddingClient::new(&config(url)).ok();
        (
            directory,
            AppState {
                index,
                embedder,
                vector_enabled: true,
                started: Instant::now(),
            },
        )
    }

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            q: Some(query.to_string()),
            apps: Vec::new(),
            exclude_apps: Vec::new(),
            tags: Vec::new(),
            date_from: None,
            date_to: None,
            limit: None,
            offset: None,
            mode: None,
        }
    }

    #[test]
    fn empty_query_returns_empty_without_embedding() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        let response = run_search(&state, request("   ")).unwrap();
        assert!(response.results.is_empty());
        assert_eq!(response.total, 0);
        assert!(!response.degraded);
        assert_eq!(response.engine, ENGINE);
    }

    #[test]
    fn hybrid_search_returns_expected_top_result() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        let response = run_search(&state, request("rust 异步")).unwrap();
        assert!(!response.degraded);
        assert!(!response.results.is_empty());
        assert_eq!(
            response.results[0].id,
            "src/content/events/0001.rust-async.md"
        );
        let health = health_response(&state);
        assert!(health.vector_enabled);
        assert_eq!(health.index_model, "mock-embed");
        assert_eq!(health.active_model.as_deref(), Some("mock-embed"));
    }

    #[test]
    fn model_mismatch_disables_vector_and_reports_health() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, mut state) = state_for(server.url());
        let mut other = config(server.url());
        other.model = "other-embed".to_string();
        state.embedder = Some(EmbeddingClient::new(&other).unwrap());
        state.vector_enabled = false;

        let response = run_search(&state, request("rust 异步")).unwrap();
        assert!(response.degraded);
        assert!(!response.results.is_empty());
        assert_eq!(
            response.results[0].id,
            "src/content/events/0001.rust-async.md"
        );

        let health = health_response(&state);
        assert!(!health.vector_enabled);
        assert_eq!(health.index_model, "mock-embed");
        assert_eq!(health.active_model.as_deref(), Some("other-embed"));
        assert_eq!(health.embed_dim, 8);
    }

    #[test]
    fn filters_are_applied_to_search() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        let mut search_request = request("rust 异步");
        search_request.apps = vec!["articles".to_string()];
        let response = run_search(&state, search_request).unwrap();
        assert!(response
            .results
            .iter()
            .all(|result| result.app_id == "articles"));

        let mut search_request = request("semantic");
        search_request.tags = vec!["rust".to_string()];
        search_request.mode = Some("fts".to_string());
        let response = run_search(&state, search_request).unwrap();
        assert!(response.results.is_empty());

        let mut search_request = request("semantic");
        search_request.date_from = Some(1_800_000_000_000);
        search_request.mode = Some("fts".to_string());
        let response = run_search(&state, search_request).unwrap();
        assert!(response.results.is_empty());
    }

    #[test]
    fn invalid_filters_are_bad_request() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        let mut search_request = request("rust");
        search_request.tags = vec!["a%b".to_string()];
        assert!(matches!(
            run_search(&state, search_request),
            Err(SearchFailure::BadRequest(_))
        ));
    }

    #[test]
    fn embedding_failure_degrades_to_fts() {
        let good = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, mut state) = state_for(good.url());
        let bad = MockEmbeddingServer::start(MockMode::Fail { status: 503 }, 0);
        state.embedder = Some(EmbeddingClient::new(&config(bad.url())).unwrap());

        let response = run_search(&state, request("rust 异步")).unwrap();
        assert!(response.degraded);
        assert!(!response.results.is_empty());
        assert_eq!(
            response.results[0].id,
            "src/content/events/0001.rust-async.md"
        );
    }

    #[test]
    fn missing_embedder_degrades_to_fts() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, mut state) = state_for(server.url());
        state.embedder = None;
        let response = run_search(&state, request("vector 数据库")).unwrap();
        assert!(response.degraded);
        assert!(!response.results.is_empty());
    }

    #[test]
    fn fts_mode_never_marks_degraded() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, mut state) = state_for(server.url());
        state.embedder = None;
        let mut search_request = request("rust");
        search_request.mode = Some("fts".to_string());
        let response = run_search(&state, search_request).unwrap();
        assert!(!response.degraded);
        assert!(!response.results.is_empty());
    }

    #[test]
    fn special_characters_do_not_fail() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        for query in ["!!! ...", "\"", "C++", "%_%"] {
            let response = run_search(&state, request(query)).expect("query");
            assert_eq!(response.engine, ENGINE);
        }
    }

    #[test]
    fn long_query_is_bad_request() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let (_dir, state) = state_for(server.url());
        let response = run_search(&state, request(&"字".repeat(257)));
        assert!(matches!(response, Err(SearchFailure::BadRequest(_))));
    }
}
