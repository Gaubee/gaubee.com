//! HTTP API：`POST /api/search` 与 `GET /health`（axum）。
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::embed::Embedder;
use crate::manifest::IndexManifest;
use crate::search::{
    build_filter, dedupe_and_page, normalize_fts_scores, ScoredHit, SearchFilters,
};
use crate::store::{SearchMode, ZvecStore};

pub struct AppState {
    pub store: ZvecStore,
    pub embedder: Embedder,
    pub index_root: PathBuf,
    pub manifest: Option<IndexManifest>,
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
    pub zvec_version: String,
    pub docs: u64,
    pub documents: Option<usize>,
    pub chunks: Option<usize>,
    pub index_built_at: Option<String>,
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
            engine: "zvec",
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
    let filter =
        build_filter(&filters).map_err(|error| SearchFailure::BadRequest(error.to_string()))?;

    // 去重要多取候选：每篇最多 40 chunk，按 8 倍扩展并设上下限。
    let fetch_k = ((offset + limit) * 8).clamp(50, 200);
    let embedding = if mode == SearchMode::Fts {
        None
    } else {
        Some(
            state
                .embedder
                .embed_query(query)
                .map_err(SearchFailure::Internal)?,
        )
    };

    let hits = state
        .store
        .search(
            mode,
            embedding.as_deref(),
            query,
            filter.as_deref(),
            fetch_k,
        )
        .map_err(SearchFailure::Internal)?;

    let mut scored = hits
        .into_iter()
        .map(|hit| ScoredHit::new(hit, mode))
        .collect::<Vec<_>>();
    if mode == SearchMode::Fts {
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
        engine: "zvec",
        degraded: false,
    })
}

async fn health_handler(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let docs = state.store.doc_count().unwrap_or(0);
    let manifest = state.manifest.as_ref();
    Json(HealthResponse {
        ok: true,
        engine: "zvec",
        zvec_version: crate::store::sdk_version(),
        docs,
        documents: manifest.map(|manifest| manifest.documents),
        chunks: manifest.map(|manifest| manifest.chunks),
        index_built_at: manifest.map(|manifest| manifest.built_at.clone()),
        index: state.index_root.display().to_string(),
        uptime_ms: state.started.elapsed().as_millis(),
    })
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
            Json(serde_json::json!({ "error": self.message, "engine": "zvec", "degraded": false })),
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
