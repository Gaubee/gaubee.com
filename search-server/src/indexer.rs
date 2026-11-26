//! 全量索引构建：内容 → chunk → magpie embedding → SQLite。
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::chunk::chunk_text_with;
use crate::content::{load_content, SourceDocument};
use crate::embed::{EmbeddingClient, EmbeddingConfig};
use crate::manifest::{now_rfc3339, IndexManifest, FORMAT_VERSION};
use crate::search::encode_tags;
use crate::store::{document_hash, tokenize_for_index, write_index, ChunkRecord};

pub struct BuildOptions {
    pub content_root: PathBuf,
    pub index_path: PathBuf,
    pub embedding: EmbeddingConfig,
    /// 复用旧索引里内容未变的向量（默认 true：日常只新增几篇，不必重建全库）。
    pub incremental: bool,
    /// 允许新算 embedding 的 chunk 上限；超过即中止。0 = 不限（构建机全量用）。
    pub max_new_chunks: usize,
    /// 切分窗口（字符）。换 embedding 模型时按新模型的滑动窗口调整。
    pub window_chars: usize,
    pub overlap_chars: usize,
    pub max_chunks_per_doc: usize,
}

#[derive(Debug)]
pub struct BuildReport {
    pub documents: usize,
    pub chunks: usize,
    /// 本次实际新算 embedding 的 chunk 数（增量时可远小于 chunks）。
    pub embedded: usize,
    /// 从旧索引复用的 chunk 数。
    pub reused: usize,
    pub duration_ms: u128,
    pub index_bytes: u64,
    pub manifest: IndexManifest,
}

pub struct CheckReport {
    pub documents: usize,
    pub content_hash: String,
    pub index_content_hash: Option<String>,
    pub expected_model: String,
    pub index_model: Option<String>,
    pub content_matches: bool,
    pub model_matches: bool,
    /// 索引结构与数据完整性（格式版本 / 表 / 行数 / 向量长度 / PRAGMA quick_check）。
    pub integrity_ok: bool,
    pub integrity_error: Option<String>,
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
        for chunk in chunk_text_with(
            &document.text,
            options.window_chars,
            options.overlap_chars,
            options.max_chunks_per_doc,
        ) {
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
        window_chars = options.window_chars,
        overlap_chars = options.overlap_chars,
        max_chunks_per_doc = options.max_chunks_per_doc,
        "chunk 切分与分词完成"
    );

    let client = EmbeddingClient::new(&options.embedding).context("初始化 embedding 客户端失败")?;

    // 增量：旧索引里 content_hash 与 chunk 序号都没变的 chunk 直接复用向量。
    // embedding 只依赖 (标题 + 正文 + 前缀模板)，三者在 hash 覆盖范围内，可安全跳过。
    //
    // 但必须先比对「向量空间身份」：同内容换模型时 hash 不变，盲目复用会把
    // 两个模型的向量混进一个索引。模型不同就忽略旧向量，本次退化为全量。
    let base_manifest = crate::store::read_index_manifest(&options.index_path)?;
    let same_space = base_manifest
        .as_ref()
        .map(|manifest| manifest.model.as_str() == client.space())
        .unwrap_or(false);
    // 切窗口/overlap/每篇上限同样会让 chunk 边界变化，不能按同序号复用。
    let same_chunking = base_manifest
        .as_ref()
        .map(|manifest| {
            manifest.chunk_window_chars == options.window_chars
                && manifest.chunk_overlap_chars == options.overlap_chars
                && manifest.max_chunks_per_doc == options.max_chunks_per_doc
        })
        .unwrap_or(false);
    if options.incremental && base_manifest.is_some() && !(same_space && same_chunking) {
        tracing::warn!(
            base_model = ?base_manifest.as_ref().map(|manifest| &manifest.model),
            current = %client.space(),
            base_window = ?base_manifest.as_ref().map(|manifest| manifest.chunk_window_chars),
            current_window = options.window_chars,
            "索引模型或切分参数不一致：忽略旧向量，本次按全量重建"
        );
    }
    let reusable = if options.incremental && same_space && same_chunking {
        crate::store::load_reusable_vectors(&options.index_path)?
    } else {
        Default::default()
    };
    // todo 里放「需要新算 embedding 的 pending 下标」；能复用的直接拿旧向量。
    let mut todo: Vec<usize> = Vec::new();
    let mut reused: Vec<(usize, Vec<f32>)> = Vec::new();
    for (index, chunk) in pending.iter().enumerate() {
        let key = (chunk.parent_id.clone(), chunk.chunk_index);
        match reusable.get(&key) {
            Some((hash, vector)) if hash == &chunk.content_hash => {
                reused.push((index, vector.clone()));
            }
            _ => todo.push(index),
        }
    }

    if !reused.is_empty() {
        tracing::info!(
            reused = reused.len(),
            pending = pending.len(),
            "增量重建：复用未变更文档的旧向量"
        );
    }

    // 上限护栏：窗口参数或模型一旦变化，todo 会等于全量。服务器只有 2 核，
    // 全量重建是小时级，宁可让自动任务失败并告警，也不能悄悄占用线上几小时。
    if options.max_new_chunks > 0 && todo.len() > options.max_new_chunks {
        bail!(
            "增量重建需要新算 {} 个 chunk，超过上限 {}（可能改了窗口参数或换过模型）。\
             请在构建机上用 --incremental false 全量重建后再上传。",
            todo.len(),
            options.max_new_chunks
        );
    }

    tracing::info!(
        model = %client.request_model(),
        identity = %client.space(),
        prompts = client.prompts().name(),
        batch_size = options.embedding.batch_size,
        concurrency = options.embedding.concurrency,
        todo = todo.len(),
        "开始请求 embedding（本地 llama.cpp 或远程网关）"
    );

    let inputs = todo
        .iter()
        .map(|index| (pending[*index].title.clone(), pending[*index].text.clone()))
        .collect::<Vec<_>>();
    let fresh = client.embed_documents(&inputs)?;
    if fresh.len() != todo.len() {
        bail!(
            "embedding 数量不匹配：期望 {}，实际 {}",
            todo.len(),
            fresh.len()
        );
    }
    let embed_dim = fresh
        .first()
        .map(Vec::len)
        .or_else(|| reused.first().map(|(_, vector)| vector.len()))
        .unwrap_or(0);
    if embed_dim == 0 {
        bail!("embedding 维度为 0");
    }
    for vector in &fresh {
        if vector.len() != embed_dim {
            bail!("embedding 维度错误：{} != {embed_dim}", vector.len());
        }
    }
    let fresh_count = fresh.len();
    let reused_count = reused.len();
    for (index, vector) in reused {
        if vector.len() != embed_dim {
            bail!(
                "复用向量维度与本次不一致：{} != {embed_dim}（索引可能来自别的模型）",
                vector.len()
            );
        }
        pending[index].embedding = vector;
    }
    for (index, vector) in todo.into_iter().zip(fresh) {
        pending[index].embedding = vector;
    }
    tracing::info!(
        embedded = fresh_count,
        reused = reused_count,
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
        model: client.space().to_string(),
        embed_dim,
        chunk_window_chars: options.window_chars,
        chunk_overlap_chars: options.overlap_chars,
        max_chunks_per_doc: options.max_chunks_per_doc,
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
        embedded: fresh_count,
        reused: reused_count,
        duration_ms: started.elapsed().as_millis(),
        index_bytes,
        manifest,
    })
}

/// 检查索引是否存在、内容指纹、embedding 模型与结构完整性（容器 entrypoint 用）。
///
/// 模型名必须参与判定：不同模型的向量空间不兼容，即使维度相同也不能复用。
/// 完整性必须参与判定：损坏或版本不匹配的索引如果只过了指纹/模型两道，`serve`
/// 会在加载时失败，容器随即进入 entrypoint 崩溃循环。
pub fn check_index(
    content_root: &Path,
    index_path: &Path,
    expected_model: &str,
) -> Result<CheckReport> {
    let documents = load_content(content_root)?;
    if documents.is_empty() {
        bail!("内容目录为空：{}", content_root.display());
    }
    let fingerprint = content_fingerprint(&documents);

    // 完整性探测：失败时不 bail，把原因带回调用方用于区分「该重建」与「已损坏」。
    let (integrity_ok, integrity_error, manifest) =
        match crate::store::verify_index_integrity(index_path) {
            Ok(manifest) => (true, None, Some(manifest)),
            Err(error) => (false, Some(format!("{error:#}")), None),
        };

    let index_content_hash = manifest
        .as_ref()
        .map(|manifest| manifest.content_hash.clone());
    let index_model = manifest.as_ref().map(|manifest| manifest.model.clone());
    let content_matches = index_content_hash.as_deref() == Some(fingerprint.as_str());
    let expected_model = expected_model.trim().to_string();
    let model_matches = index_model.as_deref() == Some(expected_model.as_str());
    Ok(CheckReport {
        documents: documents.len(),
        content_hash: fingerprint,
        index_content_hash,
        expected_model,
        index_model,
        content_matches,
        model_matches,
        integrity_ok,
        integrity_error,
        matches: content_matches && model_matches && integrity_ok,
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
    use crate::chunk::{MAX_CHUNKS_PER_DOC, OVERLAP_CHARS, WINDOW_CHARS};
    use crate::search::ValidatedFilters;
    use crate::store::{LoadedIndex, SearchMode};
    use crate::test_support::{MockEmbeddingServer, MockMode};
    use rusqlite::Connection;

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
            prompts: crate::embed::PromptProfile::None,
            timeout: std::time::Duration::from_secs(5),
            batch_size: 2,
            concurrency: 2,
            max_retries: 0,
        }
    }

    #[test]
    fn incremental_rebuild_reuses_unchanged_vectors() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        let first = build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("initial build");
        assert_eq!(first.embedded, 2);
        assert_eq!(first.reused, 0);

        // 加一篇新文档：只有它需要新算向量，两篇旧的应全部复用。
        std::fs::write(
            content.join("articles/0003.new-doc.md"),
            "---\ntitle: 新增文档\ndate: 2024-04-01\ntags:\n  - test\n---\n\n这是新增的文档正文。\n",
        )
        .unwrap();
        let second = build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("incremental build");
        assert_eq!(second.documents, 3);
        assert_eq!(second.chunks, 3);
        assert_eq!(second.reused, 2, "未变更的两篇应复用");
        assert_eq!(second.embedded, 1, "只有新增文档需要算向量");

        // 复用后的索引仍可检索到新旧内容。
        let index = LoadedIndex::open(&index_path).expect("open");
        let filters = ValidatedFilters::default();
        let hits = index
            .search(SearchMode::Fts, None, "异步", &filters, 5)
            .expect("fts old doc");
        assert_eq!(hits[0].parent_id, "src/content/events/0001.rust-async.md");
        let hits = index
            .search(SearchMode::Fts, None, "新增", &filters, 5)
            .expect("fts new doc");
        assert_eq!(hits[0].parent_id, "src/content/articles/0003.new-doc.md");

        // 全量重建（incremental=false）不读旧索引，全部重新算。
        let full = build_index(&BuildOptions {
            content_root: content,
            index_path,
            embedding: config(server.url()),
            incremental: false,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("full build");
        assert_eq!(full.reused, 0);
        assert_eq!(full.embedded, 3);
    }

    #[test]
    fn incremental_rebuild_ignores_vectors_from_other_model() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("initial build");

        // 同内容、同维度，但模型名不同：hash 虽然一样，向量空间不可混用。
        let mut other = config(server.url());
        other.model = "other-embed".to_string();
        let second = build_index(&BuildOptions {
            content_root: content,
            index_path,
            embedding: other,
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("model-switch build");
        assert_eq!(second.reused, 0, "换模型必须忽略旧向量");
        assert_eq!(second.embedded, 2, "两篇都要用新模型重算");
    }

    #[test]
    fn incremental_rebuild_ignores_vectors_from_other_chunking() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("initial build");

        // 篡改 manifest 的窗口参数，模拟「换了切分参数」的旧索引。
        let connection = Connection::open(&index_path).unwrap();
        let raw: String = connection
            .query_row("SELECT value FROM meta WHERE key = 'manifest'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let mut manifest: serde_json::Value = serde_json::from_str(&raw).unwrap();
        manifest["chunkWindowChars"] = serde_json::json!(800);
        connection
            .execute(
                "UPDATE meta SET value = ?1 WHERE key = 'manifest'",
                [manifest.to_string()],
            )
            .unwrap();
        drop(connection);

        let second = build_index(&BuildOptions {
            content_root: content,
            index_path,
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("chunking-switch build");
        assert_eq!(second.reused, 0, "切分参数变化必须忽略旧向量");
        assert_eq!(second.embedded, 2);
    }

    #[test]
    fn incremental_rebuild_recomputes_changed_document() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        build_index(&BuildOptions {
            content_root: content.clone(),
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("initial build");

        // 改动一篇正文：它必须重算，另一篇仍复用。
        std::fs::write(
            content.join("events/0001.rust-async.md"),
            "---\ntitle: Rust 异步运行时\ndate: 2024-03-01\ntags:\n  - rust\n---\n\n正文已改写，多了几个字。\n",
        )
        .unwrap();
        let second = build_index(&BuildOptions {
            content_root: content,
            index_path,
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("incremental build");
        assert_eq!(second.reused, 1, "未改动的那篇复用");
        assert_eq!(second.embedded, 1, "改动的那篇重算");
    }

    #[test]
    fn incremental_rebuild_falls_back_when_index_missing() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        // incremental=true 但索引不存在：应退化为全量，不报错。
        let report = build_index(&BuildOptions {
            content_root: content,
            index_path,
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("build without existing index");
        assert_eq!(report.reused, 0);
        assert_eq!(report.embedded, 2);
    }

    #[test]
    fn incremental_rebuild_respects_max_new_chunks() {
        let server = MockEmbeddingServer::start(MockMode::Success { dim: 8 }, 0);
        let directory = tempfile::tempdir().unwrap();
        let content = directory.path().join("content");
        write_fixture(&content);
        let index_path = directory.path().join("index.sqlite");

        // 没有旧索引 → 2 个 chunk 都要新算；上限设 1 必须中止，且不生成索引。
        let error = build_index(&BuildOptions {
            content_root: content,
            index_path: index_path.clone(),
            embedding: config(server.url()),
            incremental: true,
            max_new_chunks: 1,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .unwrap_err();
        assert!(error.to_string().contains("超过上限"), "{error:#}");
        assert!(!index_path.exists());
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
            incremental: false,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
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

        let check = check_index(&content, &index_path, "mock-embed:none").expect("check");
        assert!(check.content_matches);
        assert!(check.model_matches);
        assert!(check.matches);

        let check =
            check_index(&content, &index_path, "another-embed:none").expect("check model changed");
        assert!(check.content_matches);
        assert!(!check.model_matches);
        assert!(!check.matches);
        assert_eq!(check.index_model.as_deref(), Some("mock-embed:none"));
        assert_eq!(check.expected_model, "another-embed:none");

        // 内容变化后指纹不匹配。
        std::fs::write(
            content.join("events/0001.rust-async.md"),
            "---\ntitle: Rust 异步运行时\ndate: 2024-03-01\ntags:\n  - rust\n---\n\n内容已变化。\n",
        )
        .unwrap();
        let check = check_index(&content, &index_path, "mock-embed:none").expect("check changed");
        assert!(!check.content_matches);
        assert!(check.model_matches);
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
            incremental: false,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
        })
        .expect("initial build");
        let original = std::fs::read(&index_path).unwrap();

        let bad = MockEmbeddingServer::start(MockMode::Fail { status: 503 }, 0);
        let error = build_index(&BuildOptions {
            content_root: content,
            index_path: index_path.clone(),
            embedding: config(bad.url()),
            incremental: false,
            max_new_chunks: 0,
            window_chars: WINDOW_CHARS,
            overlap_chars: OVERLAP_CHARS,
            max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
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
