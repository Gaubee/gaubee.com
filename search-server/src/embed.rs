//! embedding 客户端（OpenAI 兼容 `/v1/embeddings`）。
//!
//! 同一个客户端同时支持两种后端，二者协议一致：
//! - 远程网关（magpie 等），需要 API key；
//! - 本地 llama.cpp `llama-server`（GGUF 量化模型），loopback 且通常无 key。
//!
//! 设计要点：
//! - 只通过环境变量/CLI 注入 key，任何日志与错误信息都不包含 key；
//! - 模型质量强依赖**任务前缀**：EmbeddingGemma 2 要 `task: search result |
//!   query:` / `title: ... | text: ...`，bge-zh 要查询指令前缀。前缀由
//!   `PromptProfile` 统一生成，build 与 serve 必须用同一 profile，否则向量
//!   空间不可比（profile 会写进索引 manifest 供 check 校验）；
//! - 批量请求默认 48 条、4 路并发，429/5xx/超时按指数退避重试；
//! - 响应按 `index` 排序，逐个校验维度并做 L2 归一化（存储与查询都归一化，
//!   检索时用点积即余弦相似度）；
//! - serve 侧超时默认 2s，失败由调用方降级到 FTS-only。
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

/// 本地 llama.cpp 默认端口（build/serve 都指向这里）。
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:18081";
/// EmbeddingGemma 2 文本核心（270M 参数，768 维，8K 上下文）。
pub const DEFAULT_MODEL: &str = "embeddinggemma-2";
/// 查询 embedding 进程内 LRU 容量（key = 模型 + 查询文本）。
pub const QUERY_CACHE_CAPACITY: usize = 256;

/// 任务前缀模板。前缀直接决定检索质量，且必须与建索引时一致。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptProfile {
    /// 不加任何前缀（mistral-embed 等通用模型）。
    None,
    /// EmbeddingGemma 2：查询 `task: search result | query: ...`，
    /// 文档 `title: {title} | text: {content}`。
    #[default]
    EmbeddingGemma2,
    /// bge-small-zh-v1.5：查询加中文检索指令，文档不加前缀。
    BgeZh,
}

impl PromptProfile {
    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "gemma2" | "embeddinggemma2" | "embeddinggemma-2" => Ok(Self::EmbeddingGemma2),
            "none" | "plain" => Ok(Self::None),
            "bge" | "bge-zh" | "bge-zh-v1.5" => Ok(Self::BgeZh),
            other => bail!("不支持的 EMBED_PROMPTS：{other}（可用 gemma2/none/bge-zh）"),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::EmbeddingGemma2 => "gemma2",
            Self::BgeZh => "bge-zh",
        }
    }

    /// 查询侧输入。
    pub fn query(&self, query: &str) -> String {
        match self {
            Self::None => query.to_string(),
            Self::EmbeddingGemma2 => format!("task: search result | query: {query}"),
            Self::BgeZh => format!("为这个句子生成表示以用于检索相关文章：{query}"),
        }
    }

    /// 文档侧输入；`title` 为空时 gemma2 按官方要求写 `title: none`。
    pub fn document(&self, title: &str, text: &str) -> String {
        match self {
            Self::None => text.to_string(),
            Self::EmbeddingGemma2 => {
                let title = if title.trim().is_empty() {
                    "none"
                } else {
                    title.trim()
                };
                format!("title: {title} | text: {text}")
            }
            Self::BgeZh => text.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct EmbeddingConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompts: PromptProfile,
    pub timeout: Duration,
    pub batch_size: usize,
    pub concurrency: usize,
    pub max_retries: u32,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            api_key: String::new(),
            model: DEFAULT_MODEL.to_string(),
            prompts: PromptProfile::default(),
            timeout: Duration::from_millis(2_000),
            batch_size: 48,
            concurrency: 4,
            max_retries: 2,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub entries: usize,
    pub hits: u64,
    pub misses: u64,
}

struct QueryCache {
    capacity: usize,
    map: HashMap<String, Vec<f32>>,
    order: VecDeque<String>,
    hits: u64,
    misses: u64,
}

impl QueryCache {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            map: HashMap::new(),
            order: VecDeque::new(),
            hits: 0,
            misses: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<Vec<f32>> {
        let Some(position) = self.order.iter().position(|item| item == key) else {
            self.misses += 1;
            return None;
        };
        let owned = self.order.remove(position)?;
        self.order.push_back(owned);
        self.hits += 1;
        self.map.get(key).cloned()
    }

    fn insert(&mut self, key: String, vector: Vec<f32>) {
        if self.capacity == 0 {
            return;
        }
        if self.map.contains_key(&key) {
            if let Some(position) = self.order.iter().position(|item| item == &key) {
                self.order.remove(position);
            }
            self.order.push_back(key.clone());
            self.map.insert(key, vector);
            return;
        }
        if self.map.len() >= self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, vector);
    }

    fn remove(&mut self, key: &str) {
        self.map.remove(key);
        if let Some(position) = self.order.iter().position(|item| item == key) {
            self.order.remove(position);
        }
    }

    fn stats(&self) -> CacheStats {
        CacheStats {
            entries: self.map.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }
}

pub struct EmbeddingClient {
    client: Client,
    endpoint: String,
    api_key: String,
    /// 请求里发的模型名（网关/llama-server 认的值）。
    model: String,
    /// 模型 + 前缀模板 = 向量空间身份，写进索引 manifest 参与一致性校验。
    identity: String,
    prompts: PromptProfile,
    batch_size: usize,
    concurrency: usize,
    max_retries: u32,
    query_cache: Mutex<QueryCache>,
}

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingItem>,
}

#[derive(Deserialize)]
struct EmbeddingItem {
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

impl EmbeddingClient {
    pub fn new(config: &EmbeddingConfig) -> Result<Self> {
        if config.model.trim().is_empty() {
            bail!("EMBED_MODEL 为空");
        }
        let local = is_local_endpoint(&config.base_url);
        if !local && config.api_key.trim().is_empty() {
            // 远程网关需要 key；本地 llama.cpp loopback 通常无鉴权。
            bail!("远程 embedding 网关需要 key（EMBED_API_KEY 为空）");
        }
        let builder = Client::builder()
            .timeout(config.timeout)
            .connect_timeout(Duration::from_millis(1_500));
        // 单测的 mock server 不适合复用 keep-alive 连接；生产保持默认连接池。
        #[cfg(test)]
        let builder = builder.pool_max_idle_per_host(0);
        let client = builder.build().context("创建 embedding HTTP 客户端失败")?;
        Ok(Self {
            client,
            endpoint: endpoint_for(&config.base_url),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
            identity: model_identity(&config.model, config.prompts),
            prompts: config.prompts,
            batch_size: config.batch_size.max(1),
            concurrency: config.concurrency.max(1),
            max_retries: config.max_retries,
            query_cache: Mutex::new(QueryCache::new(QUERY_CACHE_CAPACITY)),
        })
    }

    /// 向量空间身份（`模型:前缀模板`），与索引 manifest.model 比对。
    pub fn space(&self) -> &str {
        &self.identity
    }

    /// 请求用的原始模型名。
    pub fn request_model(&self) -> &str {
        &self.model
    }

    pub fn prompts(&self) -> PromptProfile {
        self.prompts
    }

    /// 查询向量；`expected_dim` 来自索引元数据，不匹配立即报错（调用方降级）。
    ///
    /// 进程内 LRU 按「向量空间身份 + 查询文本」复用；命中时直接返回归一化向量。
    pub fn embed_query(&self, query: &str, expected_dim: usize) -> Result<Vec<f32>> {
        let key = format!("{}\u{0}{query}", self.identity);
        if let Ok(mut cache) = self.query_cache.lock() {
            if let Some(vector) = cache.get(&key) {
                if vector.len() == expected_dim {
                    return Ok(vector);
                }
                cache.remove(&key);
            }
        }

        let prefixed = self.prompts.query(query);
        let mut vectors = self.embed_all(std::slice::from_ref(&prefixed))?;
        let vector = vectors.pop().context("query embedding 返回空结果")?;
        if vector.len() != expected_dim {
            bail!(
                "query embedding 维度不匹配：期望 {expected_dim}，实际 {}（模型或索引不一致）",
                vector.len()
            );
        }
        if let Ok(mut cache) = self.query_cache.lock() {
            cache.insert(key, vector.clone());
        }
        Ok(vector)
    }

    pub fn cache_stats(&self) -> CacheStats {
        self.query_cache
            .lock()
            .map(|cache| cache.stats())
            .unwrap_or_default()
    }

    /// 文档批量 embedding：按前缀模板包装 `(标题, 正文)`，返回顺序与输入一致。
    pub fn embed_documents(&self, documents: &[(String, String)]) -> Result<Vec<Vec<f32>>> {
        let texts = documents
            .iter()
            .map(|(title, text)| self.prompts.document(title, text))
            .collect::<Vec<_>>();
        self.embed_all(&texts)
    }

    /// 批量 embedding，返回顺序与输入一致；所有向量已 L2 归一化。
    pub fn embed_all(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let batches = texts.chunks(self.batch_size).collect::<Vec<&[String]>>();

        let results = if batches.len() == 1 || self.concurrency == 1 {
            let mut output = Vec::with_capacity(batches.len());
            for batch in &batches {
                output.push(self.embed_batch(batch)?);
            }
            output
        } else {
            self.embed_batches_concurrent(&batches)?
        };

        let mut vectors = Vec::with_capacity(texts.len());
        for batch in results {
            vectors.extend(batch);
        }
        if vectors.len() != texts.len() {
            bail!(
                "embedding 数量不匹配：期望 {}，实际 {}",
                texts.len(),
                vectors.len()
            );
        }
        let dim = vectors.first().map(Vec::len).unwrap_or(0);
        if dim == 0 {
            bail!("embedding 返回空向量");
        }
        for vector in &mut vectors {
            if vector.len() != dim {
                bail!("embedding 维度不一致：期望 {dim}，实际 {}", vector.len());
            }
            l2_normalize(vector);
        }
        Ok(vectors)
    }

    fn embed_batches_concurrent(&self, batches: &[&[String]]) -> Result<Vec<Vec<Vec<f32>>>> {
        let workers = self.concurrency.min(batches.len());
        let cursor = AtomicUsize::new(0);
        let mut slots: Vec<Option<Result<Vec<Vec<f32>>>>> =
            (0..batches.len()).map(|_| None).collect();

        std::thread::scope(|scope| -> Result<()> {
            let (sender, receiver) = mpsc::channel::<(usize, Result<Vec<Vec<f32>>>)>();
            for _ in 0..workers {
                let sender = sender.clone();
                let cursor = &cursor;
                scope.spawn(move || loop {
                    let index = cursor.fetch_add(1, Ordering::Relaxed);
                    if index >= batches.len() {
                        break;
                    }
                    let result = self.embed_batch(batches[index]);
                    if sender.send((index, result)).is_err() {
                        break;
                    }
                });
            }
            drop(sender);
            while let Ok((index, result)) = receiver.recv() {
                slots[index] = Some(result);
            }
            Ok(())
        })?;

        let mut output = Vec::with_capacity(slots.len());
        for slot in slots {
            output.push(slot.context("embedding 批次缺失（工作线程异常退出）")??);
        }
        Ok(output)
    }

    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let mut attempt = 0u32;
        loop {
            match self.embed_batch_once(texts) {
                Ok(vectors) => return Ok(vectors),
                Err(error) => {
                    if error.split_batch && texts.len() > 1 {
                        let middle = texts.len() / 2;
                        tracing::warn!(
                            batch = texts.len(),
                            left = middle,
                            right = texts.len() - middle,
                            "embedding 批次超过网关 token 上限，拆分为两个子批次重试"
                        );
                        let mut vectors = self.embed_batch(&texts[..middle])?;
                        vectors.extend(self.embed_batch(&texts[middle..])?);
                        return Ok(vectors);
                    }
                    let retryable = error.retryable;
                    if !retryable || attempt >= self.max_retries {
                        return Err(error.message);
                    }
                    let backoff = backoff_delay(attempt, error.retry_after);
                    tracing::warn!(
                        attempt = attempt + 1,
                        max = self.max_retries,
                        delay_ms = backoff.as_millis(),
                        reason = %error.message,
                        "embedding 请求失败，退避重试"
                    );
                    std::thread::sleep(backoff);
                    attempt += 1;
                }
            }
        }
    }

    fn embed_batch_once(&self, texts: &[String]) -> std::result::Result<Vec<Vec<f32>>, BatchError> {
        let request = EmbeddingRequest {
            model: &self.model,
            input: texts,
        };
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send();

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                return Err(BatchError {
                    retryable: error.is_timeout() || error.is_connect() || error.is_request(),
                    retry_after: None,
                    split_batch: false,
                    message: anyhow::anyhow!("embedding 网络错误：{error}"),
                });
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok());
            let body = response.text().unwrap_or_default();
            // 网关不应回显 Authorization；仍做一次防御性脱敏，保证日志绝不出现 key。
            let snippet = body
                .chars()
                .take(300)
                .collect::<String>()
                .replace(&self.api_key, "[redacted]");
            // 在完整 body 上判断，避免 300 字截断把标记截掉。
            let split_batch = status.as_u16() == 400
                && (body.contains("Too many tokens")
                    || body.contains("context_length_exceeded")
                    || body.to_ascii_lowercase().contains("too many tokens"));
            return Err(BatchError {
                retryable: status.as_u16() == 429 || status.is_server_error(),
                retry_after,
                split_batch,
                message: anyhow::anyhow!("embedding 网关返回 {status}：{snippet}"),
            });
        }

        let payload = response
            .json::<EmbeddingResponse>()
            .map_err(|error| BatchError {
                retryable: false,
                retry_after: None,
                split_batch: false,
                message: anyhow::anyhow!("解析 embedding 响应失败：{error}"),
            })?;
        if payload.data.len() != texts.len() {
            return Err(BatchError {
                retryable: false,
                retry_after: None,
                split_batch: false,
                message: anyhow::anyhow!(
                    "embedding 返回条数不匹配：期望 {}，实际 {}",
                    texts.len(),
                    payload.data.len()
                ),
            });
        }

        let mut items = payload.data;
        if items.iter().all(|item| item.index.is_some()) {
            items.sort_by_key(|item| item.index.unwrap_or(0));
        }
        Ok(items.into_iter().map(|item| item.embedding).collect())
    }
}

struct BatchError {
    retryable: bool,
    retry_after: Option<u64>,
    split_batch: bool,
    message: anyhow::Error,
}

fn backoff_delay(attempt: u32, retry_after: Option<u64>) -> Duration {
    if let Some(seconds) = retry_after {
        return Duration::from_secs(seconds.min(30));
    }
    let millis = 500u64.saturating_mul(1u64 << attempt.min(5));
    Duration::from_millis(millis.min(15_000))
}

pub fn endpoint_for(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{trimmed}/embeddings")
    } else {
        format!("{trimmed}/v1/embeddings")
    }
}

/// 向量空间身份：`模型:前缀模板`。前缀会改变向量分布，必须参与索引一致性校验。
pub fn model_identity(model: &str, prompts: PromptProfile) -> String {
    format!("{}:{}", model.trim(), prompts.name())
}

/// loopback / 私网地址视为本地后端（不要求 key）。
fn is_local_endpoint(base_url: &str) -> bool {
    let trimmed = base_url.trim();
    let host = trimmed
        .split("://")
        .nth(1)
        .unwrap_or(trimmed)
        .split(['/', ':'])
        .next()
        .unwrap_or("");
    host == "127.0.0.1"
        || host == "localhost"
        || host == "::1"
        || host == "0.0.0.0"
        || host.starts_with("10.")
        || host.starts_with("192.168.")
}

pub fn l2_normalize(vector: &mut [f32]) {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for value in vector.iter_mut() {
            *value /= norm;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockEmbeddingServer, MockMode};

    fn config(base_url: String, timeout_ms: u64) -> EmbeddingConfig {
        EmbeddingConfig {
            base_url,
            api_key: "test-key".to_string(),
            model: "mock-embed".to_string(),
            prompts: PromptProfile::None,
            timeout: Duration::from_millis(timeout_ms),
            batch_size: 4,
            concurrency: 2,
            max_retries: 0,
        }
    }

    #[test]
    fn default_backend_is_local_embeddinggemma2() {
        assert_eq!(DEFAULT_BASE_URL, "http://127.0.0.1:18081");
        assert_eq!(DEFAULT_MODEL, "embeddinggemma-2");
        assert_eq!(QUERY_CACHE_CAPACITY, 256);
        assert_eq!(PromptProfile::default(), PromptProfile::EmbeddingGemma2);
    }

    #[test]
    fn prompt_profiles_match_official_templates() {
        let gemma = PromptProfile::EmbeddingGemma2;
        assert_eq!(
            gemma.query("语义搜索"),
            "task: search result | query: 语义搜索"
        );
        assert_eq!(gemma.document("标题", "正文"), "title: 标题 | text: 正文");
        assert_eq!(gemma.document("", "正文"), "title: none | text: 正文");

        let bge = PromptProfile::BgeZh;
        assert_eq!(
            bge.query("语义搜索"),
            "为这个句子生成表示以用于检索相关文章：语义搜索"
        );
        assert_eq!(bge.document("标题", "正文"), "正文");

        assert_eq!(PromptProfile::None.query("q"), "q");
        assert_eq!(PromptProfile::None.document("t", "x"), "x");
    }

    #[test]
    fn prompt_profile_parsing_and_identity() {
        assert_eq!(
            PromptProfile::parse("gemma2").unwrap(),
            PromptProfile::EmbeddingGemma2
        );
        assert_eq!(
            PromptProfile::parse("bge-zh").unwrap(),
            PromptProfile::BgeZh
        );
        assert_eq!(PromptProfile::parse("none").unwrap(), PromptProfile::None);
        assert!(PromptProfile::parse("unknown").is_err());
        assert_eq!(
            model_identity("embeddinggemma-2", PromptProfile::EmbeddingGemma2),
            "embeddinggemma-2:gemma2"
        );
        assert_ne!(
            model_identity("bge", PromptProfile::None),
            model_identity("bge", PromptProfile::BgeZh)
        );
    }

    #[test]
    fn local_endpoints_do_not_require_key() {
        let mut config = config("http://127.0.0.1:1/v1/embeddings".to_string(), 1_000);
        config.api_key = String::new();
        assert!(EmbeddingClient::new(&config).is_ok());
        assert!(is_local_endpoint("http://localhost:18081"));
        assert!(is_local_endpoint("http://192.168.1.10:18081"));
        assert!(!is_local_endpoint("https://magpie.aiweb.xin"));

        let mut remote = config.clone();
        remote.base_url = "https://magpie.aiweb.xin".to_string();
        assert!(EmbeddingClient::new(&remote).is_err());
    }

    #[test]
    fn query_cache_reuses_model_and_text() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let client = EmbeddingClient::new(&config(server.url(), 5_000)).expect("client");
        let first = client.embed_query("rust 异步", 8).expect("first");
        let second = client.embed_query("rust 异步", 8).expect("cached");
        assert_eq!(first, second);
        let stats = client.cache_stats();
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);

        client.embed_query("另一个查询", 8).expect("miss");
        let stats = client.cache_stats();
        assert_eq!(stats.entries, 2);
        assert_eq!(stats.misses, 2);
    }

    #[test]
    fn splits_batches_when_gateway_token_limit_exceeded() {
        let server = MockEmbeddingServer::start(
            MockMode::TooManyTokens {
                dim: 8,
                max_batch: 3,
            },
            0,
        );
        let mut config = config(server.url(), 5_000);
        config.batch_size = 5;
        config.concurrency = 1;
        config.max_retries = 0;
        let client = EmbeddingClient::new(&config).expect("client");
        let texts = (0..10)
            .map(|index| format!("text-{index}"))
            .collect::<Vec<_>>();
        let vectors = client.embed_all(&texts).expect("split and embed");
        assert_eq!(vectors.len(), 10);
        assert!(vectors.iter().all(|vector| vector.len() == 8));
    }

    #[test]
    fn query_cache_is_lru() {
        let mut cache = QueryCache::new(2);
        cache.insert("a".to_string(), vec![1.0]);
        cache.insert("b".to_string(), vec![2.0]);
        assert_eq!(cache.get("a"), Some(vec![1.0]));
        cache.insert("c".to_string(), vec![3.0]);
        assert!(cache.map.contains_key("a"));
        assert!(!cache.map.contains_key("b"));
        assert!(cache.map.contains_key("c"));
        assert_eq!(cache.get("b"), None);
        assert_eq!(cache.stats().entries, 2);
    }

    #[test]
    fn endpoint_accepts_base_v1_or_full_path() {
        assert_eq!(
            endpoint_for("http://127.0.0.1:3425"),
            "http://127.0.0.1:3425/v1/embeddings"
        );
        assert_eq!(
            endpoint_for("http://127.0.0.1:3425/v1/"),
            "http://127.0.0.1:3425/v1/embeddings"
        );
        assert_eq!(
            endpoint_for("https://x/v1/embeddings"),
            "https://x/v1/embeddings"
        );
    }

    #[test]
    fn embeds_in_order_with_concurrency() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let client = EmbeddingClient::new(&config(server.url(), 5_000)).expect("client");
        let texts = (0..10)
            .map(|index| format!("text-{index}"))
            .collect::<Vec<_>>();
        let vectors = client.embed_all(&texts).expect("embed");
        assert_eq!(vectors.len(), 10);
        for vector in &vectors {
            assert_eq!(vector.len(), 8);
            let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
            assert!((norm - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn dimension_mismatch_is_detected() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let client = EmbeddingClient::new(&config(server.url(), 5_000)).expect("client");
        let error = client.embed_query("hello", 16).unwrap_err();
        assert!(error.to_string().contains("维度不匹配"));
    }

    #[test]
    fn timeout_is_reported() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 500);
        let client = EmbeddingClient::new(&config(server.url(), 80)).expect("client");
        let error = client.embed_query("hello", 8).unwrap_err();
        assert!(error.to_string().contains("网络错误"));
    }

    #[test]
    fn server_errors_are_reported() {
        let server = MockEmbeddingServer::start(MockMode::Fail { status: 503 }, 0);
        let mut config = config(server.url(), 2_000);
        config.max_retries = 0;
        let client = EmbeddingClient::new(&config).expect("client");
        let error = client.embed_query("hello", 8).unwrap_err();
        assert!(error.to_string().contains("503"), "error={error:#}");
    }

    #[test]
    fn backoff_honours_retry_after_and_caps() {
        assert_eq!(backoff_delay(0, Some(3)), Duration::from_secs(3));
        assert_eq!(backoff_delay(0, Some(300)), Duration::from_secs(30));
        assert_eq!(backoff_delay(0, None), Duration::from_millis(500));
        assert_eq!(backoff_delay(10, None), Duration::from_millis(15_000));
    }

    #[test]
    fn normalizes_zero_and_nonzero() {
        let mut zero = vec![0.0f32; 3];
        l2_normalize(&mut zero);
        assert_eq!(zero, vec![0.0, 0.0, 0.0]);
        let mut vector = vec![3.0f32, 4.0];
        l2_normalize(&mut vector);
        assert!((vector[0] - 0.6).abs() < 1e-6);
        assert!((vector[1] - 0.8).abs() < 1e-6);
    }
}
