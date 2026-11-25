//! magpie 网关 embedding 客户端（OpenAI 兼容 `/v1/embeddings`）。
//!
//! 设计要点：
//! - 只通过环境变量/CLI 注入 key，任何日志与错误信息都不包含 key；
//! - 批量请求默认 64 条、4 路并发，429/5xx/超时按指数退避重试；
//! - 响应按 `index` 排序，逐个校验维度并做 L2 归一化（存储与查询都归一化，
//!   检索时用点积即余弦相似度）；
//! - serve 侧超时默认 2s，失败由调用方降级到 FTS-only。
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

pub const DEFAULT_BASE_URL: &str = "https://magpie.aiweb.xin";
pub const DEFAULT_MODEL: &str = "text-embedding-3-small";

#[derive(Clone)]
pub struct EmbeddingConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
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
            timeout: Duration::from_millis(2_000),
            batch_size: 64,
            concurrency: 4,
            max_retries: 2,
        }
    }
}

pub struct EmbeddingClient {
    client: Client,
    endpoint: String,
    api_key: String,
    model: String,
    batch_size: usize,
    concurrency: usize,
    max_retries: u32,
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
        if config.api_key.trim().is_empty() {
            bail!("MAGPIE_API_KEY 为空");
        }
        if config.model.trim().is_empty() {
            bail!("MAGPIE_EMBED_MODEL 为空");
        }
        let client = Client::builder()
            .timeout(config.timeout)
            .connect_timeout(Duration::from_millis(1_500))
            .build()
            .context("创建 embedding HTTP 客户端失败")?;
        Ok(Self {
            client,
            endpoint: endpoint_for(&config.base_url),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
            batch_size: config.batch_size.max(1),
            concurrency: config.concurrency.max(1),
            max_retries: config.max_retries,
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// 查询向量；`expected_dim` 来自索引元数据，不匹配立即报错（调用方降级）。
    pub fn embed_query(&self, query: &str, expected_dim: usize) -> Result<Vec<f32>> {
        let mut vectors = self.embed_all(std::slice::from_ref(&query.to_string()))?;
        let vector = vectors.pop().context("query embedding 返回空结果")?;
        if vector.len() != expected_dim {
            bail!(
                "query embedding 维度不匹配：期望 {expected_dim}，实际 {}（模型或索引不一致）",
                vector.len()
            );
        }
        Ok(vector)
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
            return Err(BatchError {
                retryable: status.as_u16() == 429 || status.is_server_error(),
                retry_after,
                message: anyhow::anyhow!("embedding 网关返回 {status}：{snippet}"),
            });
        }

        let payload = response
            .json::<EmbeddingResponse>()
            .map_err(|error| BatchError {
                retryable: false,
                retry_after: None,
                message: anyhow::anyhow!("解析 embedding 响应失败：{error}"),
            })?;
        if payload.data.len() != texts.len() {
            return Err(BatchError {
                retryable: false,
                retry_after: None,
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
            timeout: Duration::from_millis(timeout_ms),
            batch_size: 4,
            concurrency: 2,
            max_retries: 1,
        }
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
