//! 全量索引构建：内容 → chunk → magpie embedding → SQLite。
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::chunk::{chunk_text, embedding_input, MAX_CHUNKS_PER_DOC, OVERLAP_CHARS, WINDOW_CHARS};
use crate::content::{load_content, SourceDocument};
use crate::embed::{EmbeddingClient, EmbeddingConfig};
use crate::manifest::{now_rfc3339, IndexManifest, FORMAT_VERSION};
use crate::search::encode_tags;
use crate::store::{document_hash, tokenize_for_index, write_index, ChunkRecord};

pub struct BuildOptions {
    pub content_root: PathBuf,
    pub index_path: PathBuf,
    pub embedding: EmbeddingConfig,
}

#[derive(Debug)]
pub struct BuildReport {
    pub documents: usize,
    pub chunks: usize,
    pub duration_ms: u128,
    pub index_bytes: u64,
    pub manifest: IndexManifest,
}

pub struct CheckReport {
    pub documents: usize,
    pub content_hash: String,
    pub index_content_hash: Option<String>,
    pub matches: bool,
}

struct PendingChunk {
    parent_id: String,
    app_id: String,
    title: String,
    tags: String,
    date: i64,
    chunk_index: i32,
    content_hash: String,
    href: String,
    text: String,
    text_tokens: String,
    embed_input: String,
    embedding: Vec<f32>,
}

/// 全量重建索引（先写临时文件再原子替换，失败不破坏旧索引）。
pub fn build_index(options: &BuildOptions) -> Result<BuildReport> {
    let started = Instant::now();
    let documents = load_content(&options.content_root)?;
    if documents.is_empty() {
        bail!(
            "内容目录为空：{}（期望 src/content/{{articles,events}}/*.md）",
            options.content_root.display()
        );
    }
    tracing::info!(documents = documents.len(), "内容读取完成");
    let fingerprint = content_fingerprint(&documents);

    let mut pending = Vec::new();
    let mut apps: BTreeMap<String, usize> = BTreeMap::new();
    for document in &documents {
        let hash = document_hash(
            &document.title,
            &document.tags,
            document.date,
            &document.text,
        );
        *apps.entry(document.app_id.clone()).or_default() += 1;
        for chunk in chunk_text(&document.text) {
            pending.push(PendingChunk {
                parent_id: document.parent_id.clone(),
                app_id: document.app_id.clone(),
                title: document.title.clone(),
                tags: encode_tags(&document.tags),
                date: document.date,
                chunk_index: chunk.index as i32,
                content_hash: hash.clone(),
                href: document.href.clone(),
                text_tokens: tokenize_for_index(&format!("{} {}", document.title, chunk.text)),
                embed_input: embedding_input(&document.title, &chunk.text),
                text: chunk.text,
                embedding: Vec::new(),
            });
        }
    }
    if pending.is_empty() {
        bail!("内容切分后没有可索引的 chunk");
    }
    tracing::info!(
        chunks = pending.len(),
        window_chars = WINDOW_CHARS,
        overlap_chars = OVERLAP_CHARS,
        max_chunks_per_doc = MAX_CHUNKS_PER_DOC,
        "chunk 切分与分词完成"
    );

    let client = EmbeddingClient::new(&options.embedding).context("初始化 embedding 客户端失败")?;
    tracing::info!(
        model = %options.embedding.model,
        batch_size = options.embedding.batch_size,
        concurrency = options.embedding.concurrency,
        "开始请求 magpie embedding"
    );
    let inputs = pending
        .iter()
        .map(|chunk| chunk.embed_input.clone())
        .collect::<Vec<_>>();
    let vectors = client.embed_all(&inputs)?;
    if vectors.len() != pending.len() {
        bail!(
            "embedding 数量不匹配：期望 {}，实际 {}",
            pending.len(),
            vectors.len()
        );
    }
    let embed_dim = vectors.first().map(Vec::len).unwrap_or(0);
    if embed_dim == 0 {
        bail!("embedding 维度为 0");
    }
    for (chunk, vector) in pending.iter_mut().zip(vectors) {
        if vector.len() != embed_dim {
            bail!("embedding 维度错误：{} != {embed_dim}", vector.len());
        }
        chunk.embedding = vector;
    }
    tracing::info!(
        embedded = pending.len(),
        dim = embed_dim,
        elapsed_ms = started.elapsed().as_millis(),
        "embedding 完成"
    );

    let manifest = IndexManifest {
        version: FORMAT_VERSION,
        built_at: now_rfc3339(),
        content_hash: fingerprint,
        documents: documents.len(),
        chunks: pending.len(),
        apps,
        model: options.embedding.model.clone(),
        embed_dim,
        chunk_window_chars: WINDOW_CHARS,
        chunk_overlap_chars: OVERLAP_CHARS,
        max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
    };

    let records = pending
        .iter()
        .map(|chunk| ChunkRecord {
            parent_id: &chunk.parent_id,
            app_id: &chunk.app_id,
            title: &chunk.title,
            tags: &chunk.tags,
            date: chunk.date,
            chunk_index: chunk.chunk_index,
            content_hash: &chunk.content_hash,
            href: &chunk.href,
            text: &chunk.text,
            text_tokens: &chunk.text_tokens,
            embedding: &chunk.embedding,
        })
        .collect::<Vec<_>>();

    let index_bytes = write_index(&options.index_path, &records, &manifest)
        .with_context(|| format!("写入索引失败：{}", options.index_path.display()))?;

    Ok(BuildReport {
        documents: documents.len(),
        chunks: pending.len(),
        duration_ms: started.elapsed().as_millis(),
        index_bytes,
        manifest,
    })
}

/// 检查索引是否存在且内容指纹一致（容器 entrypoint 用）。
pub fn check_index(content_root: &Path, index_path: &Path) -> Result<CheckReport> {
    let documents = load_content(content_root)?;
    if documents.is_empty() {
        bail!("内容目录为空：{}", content_root.display());
    }
    let fingerprint = content_fingerprint(&documents);
    let index_content_hash = crate::store::read_content_hash(index_path)?;
    let matches = index_content_hash.as_deref() == Some(fingerprint.as_str());
    Ok(CheckReport {
        documents: documents.len(),
        content_hash: fingerprint,
        index_content_hash,
        matches,
    })
}

/// 内容级指纹：按 parentId 排序后对每篇文档 hash 做 sha256。
pub fn content_fingerprint(documents: &[SourceDocument]) -> String {
    let mut hashes = documents
        .iter()
        .map(|document| {
            (
                document.parent_id.as_str(),
                document_hash(
                    &document.title,
                    &document.tags,
                    document.date,
                    &document.text,
                ),
            )
        })
        .collect::<Vec<_>>();
    hashes.sort();
    let mut hasher = Sha256::new();
    for (parent, hash) in &hashes {
        hasher.update(parent.as_bytes());
        hasher.update(b"\0");
        hasher.update(hash.as_bytes());
        hasher.update(b"\n");
    }
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::ValidatedFilters;
    use crate::store::{LoadedIndex, SearchMode};
    use crate::test_support::{MockEmbeddingServer, MockMode};

    fn write_fixture(root: &Path) {
        std::fs::create_dir_all(root.join("events")).unwrap();
        std::fs::create_dir_all(root.join("articles")).unwrap();
        std::fs::write(
            root.join("events/0001.rust-async.md"),
            "---\ntitle: Rust 异步运行时\ndate: 2024-03-01\ntags:\n  - rust\n  - async\n---\n\nRust 异步运行时 tokio 与并发调度。\n",
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
            max_retries: 0,
        }
    }

    #[test]
    fn builds_index_with_mock_embeddings_and_searches() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        let report = build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
        })
        .expect("build");
        assert_eq!(report.documents, 2);
        assert_eq!(report.chunks, 2);
        assert!(report.index_bytes > 0);
        assert!(index_path.is_file());

        let index = LoadedIndex::open(&index_path).expect("open");
        assert_eq!(index.dim(), 8);
        let filters = ValidatedFilters::default();

        let hits = index
            .search(SearchMode::Fts, None, "异步", &filters, 5)
            .expect("fts");
        assert_eq!(hits[0].parent_id, "src/content/events/0001.rust-async.md");

        let client = EmbeddingClient::new(&config(server.url())).unwrap();
        let query = client.embed_query("rust 异步", 8).unwrap();
        let hits = index
            .search(SearchMode::Vector, Some(&query), "rust 异步", &filters, 5)
            .expect("vector");
        assert_eq!(hits[0].parent_id, "src/content/events/0001.rust-async.md");

        let hits = index
            .search(SearchMode::Hybrid, Some(&query), "semantic", &filters, 5)
            .expect("hybrid");
        assert!(!hits.is_empty());

        let check = check_index(&content, &index_path).expect("check");
        assert!(check.matches);

        // 内容变化后指纹不匹配。
        std::fs::write(
            content.join("events/0001.rust-async.md"),
            "---\ntitle: Rust 异步运行时\ndate: 2024-03-01\ntags:\n  - rust\n---\n\n内容已变化。\n",
        )
        .unwrap();
        let check = check_index(&content, &index_path).expect("check changed");
        assert!(!check.matches);
    }

    #[test]
    fn failed_embedding_keeps_old_index() {
        let good = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");
        build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(good.url()),
        })
        .expect("initial build");
        let original = std::fs::read(&index_path).unwrap();

        let bad = MockEmbeddingServer::start(MockMode::Fail { status: 503 }, 0);
        let error = build_index(&BuildOptions {
            content_root: content,
            index_path: index_path.clone(),
            embedding: config(bad.url()),
        })
        .unwrap_err();
        assert!(error.to_string().contains("503"));
        assert_eq!(std::fs::read(&index_path).unwrap(), original);
        assert!(LoadedIndex::open(&index_path).is_ok());
    }

    #[test]
    fn fingerprint_changes_with_title_or_body() {
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let documents = load_content(&content).unwrap();
        let first = content_fingerprint(&documents);
        let mut changed_title = documents.clone();
        changed_title[0].title.push('!');
        assert_ne!(first, content_fingerprint(&changed_title));
        let mut changed_body = documents.clone();
        changed_body[0].text.push('!');
        assert_ne!(first, content_fingerprint(&changed_body));
    }
}
