//! 全量索引构建：内容 → chunk → embedding → zvec。
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use tokenizers::Tokenizer;

use crate::chunk::{
    chunk_document, content_hash, MAX_CHUNKS_PER_DOC, OVERLAP_TOKENS, WINDOW_TOKENS,
};
use crate::content::{load_content, SourceDocument};
use crate::embed::Embedder;
use crate::manifest::{
    collection_path, directory_size, now_rfc3339, write_manifest, IndexManifest,
};
use crate::search::encode_tags;
use crate::store::{ChunkDocument, ZvecStore, EMBEDDING_DIM};

pub struct BuildOptions {
    pub content_root: PathBuf,
    pub index_root: PathBuf,
    pub model_dir: PathBuf,
    pub threads: usize,
}

pub struct BuildReport {
    pub documents: usize,
    pub chunks: usize,
    pub duration_ms: u128,
    pub index_bytes: u64,
    pub manifest: IndexManifest,
}

struct PendingChunk {
    id: String,
    parent_id: String,
    app_id: String,
    title: String,
    tags: String,
    date: i64,
    chunk_index: i32,
    content_hash: String,
    href: String,
    text: String,
    embedding: Vec<f32>,
}

/// 全量重建索引（先删除旧 collection，再写入新数据）。
pub fn build_index(options: &BuildOptions) -> Result<BuildReport> {
    let started = Instant::now();
    let tokenizer_path = options.model_dir.join("tokenizer.json");
    let model_path = options.model_dir.join("model.onnx");
    if !tokenizer_path.is_file() || !model_path.is_file() {
        bail!(
            "模型文件缺失：{} / {}（先运行 search-server/scripts/fetch-model.sh）",
            tokenizer_path.display(),
            model_path.display()
        );
    }

    let documents = load_content(&options.content_root)?;
    if documents.is_empty() {
        bail!(
            "内容目录为空：{}（期望 src/content/{{articles,events}}/*.md）",
            options.content_root.display()
        );
    }
    tracing::info!(documents = documents.len(), "内容读取完成");

    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|error| anyhow::anyhow!("加载 tokenizer 失败：{error}"))?;

    let mut pending = Vec::new();
    let mut apps: BTreeMap<String, usize> = BTreeMap::new();
    let mut parent_hashes: Vec<(String, String)> = Vec::new();

    for document in &documents {
        let hash = document_hash(document);
        parent_hashes.push((document.parent_id.clone(), hash.clone()));
        *apps.entry(document.app_id.clone()).or_default() += 1;
        for chunk in chunk_document(&tokenizer, document) {
            pending.push(PendingChunk {
                id: format!("{}#{}", document.parent_id, chunk.index),
                parent_id: document.parent_id.clone(),
                app_id: document.app_id.clone(),
                title: document.title.clone(),
                tags: encode_tags(&document.tags),
                date: document.date,
                chunk_index: chunk.index as i32,
                content_hash: hash.clone(),
                href: document.href.clone(),
                text: chunk.text,
                embedding: Vec::new(),
            });
        }
    }
    tracing::info!(
        chunks = pending.len(),
        max_chunks_per_doc = MAX_CHUNKS_PER_DOC,
        "chunk 切分完成"
    );

    let embedder = Embedder::load(&model_path, &tokenizer_path, options.threads)?;
    tracing::info!(
        threads = options.threads,
        dim = EMBEDDING_DIM,
        "E5 模型加载完成"
    );

    // 分批 embedding（控制内存峰值，同时给进度）。
    const EMBED_BATCH: usize = 64;
    let total_chunks = pending.len();
    let mut embedded = 0usize;
    for batch in pending.chunks_mut(EMBED_BATCH) {
        let passages = batch
            .iter()
            .map(|chunk| chunk.text.clone())
            .collect::<Vec<_>>();
        let vectors = embedder.embed_passages(&passages)?;
        if vectors.len() != batch.len() {
            bail!(
                "embedding 数量不匹配：期望 {}，实际 {}",
                batch.len(),
                vectors.len()
            );
        }
        for (chunk, vector) in batch.iter_mut().zip(vectors) {
            if vector.len() != EMBEDDING_DIM {
                bail!("embedding 维度错误：{}", vector.len());
            }
            chunk.embedding = vector;
        }
        embedded += batch.len();
        if embedded % 512 < EMBED_BATCH || embedded == total_chunks {
            tracing::info!(embedded, total = total_chunks, "embedding 进度");
        }
    }

    // embedding 全部成功后才删除旧索引，避免中途失败丢可用索引。
    if options.index_root.exists() {
        fs::remove_dir_all(&options.index_root)
            .with_context(|| format!("删除旧索引失败：{}", options.index_root.display()))?;
    }
    fs::create_dir_all(&options.index_root)?;
    let collection = collection_path(&options.index_root);

    let store = ZvecStore::create(&collection)?;
    let mut written = 0usize;
    for batch in pending.chunks(500) {
        let docs = batch
            .iter()
            .map(|chunk| ChunkDocument {
                id: chunk.id.clone(),
                parent_id: &chunk.parent_id,
                app_id: &chunk.app_id,
                title: &chunk.title,
                tags: &chunk.tags,
                date: chunk.date,
                chunk_index: chunk.chunk_index,
                content_hash: &chunk.content_hash,
                href: &chunk.href,
                text: &chunk.text,
                embedding: &chunk.embedding,
            })
            .collect::<Vec<_>>();
        store.insert(&docs)?;
        written += docs.len();
        tracing::info!(written, total = pending.len(), "写入进度");
    }

    store.optimize()?;
    store.flush()?;
    let doc_count = store.doc_count()?;
    drop(store);

    if doc_count as usize != pending.len() {
        bail!(
            "写入数量校验失败：zvec doc_count={doc_count}，期望 {}",
            pending.len()
        );
    }

    parent_hashes.sort();
    let mut hasher = Sha256::new();
    for (parent, hash) in &parent_hashes {
        hasher.update(parent.as_bytes());
        hasher.update(b"\0");
        hasher.update(hash.as_bytes());
        hasher.update(b"\n");
    }
    let index_hash = hex::encode(hasher.finalize());

    let manifest = IndexManifest {
        version: 1,
        built_at: now_rfc3339(),
        content_hash: index_hash,
        documents: documents.len(),
        chunks: pending.len(),
        apps,
        model: "intfloat/multilingual-e5-small@614241f".to_string(),
        zvec_version: crate::store::sdk_version(),
        embed_dim: EMBEDDING_DIM,
        chunk_window: WINDOW_TOKENS,
        chunk_overlap: OVERLAP_TOKENS,
        max_chunks_per_doc: MAX_CHUNKS_PER_DOC,
    };
    write_manifest(&options.index_root, &manifest)?;

    let index_bytes = directory_size(&collection);
    Ok(BuildReport {
        documents: documents.len(),
        chunks: pending.len(),
        duration_ms: started.elapsed().as_millis(),
        index_bytes,
        manifest,
    })
}

/// parent 级内容指纹：标题/标签/日期/正文任一变化都会改变。
pub fn document_hash(document: &SourceDocument) -> String {
    let mut hasher = Sha256::new();
    hasher.update(document.title.as_bytes());
    hasher.update(b"\0");
    hasher.update(document.tags.join(",").as_bytes());
    hasher.update(b"\0");
    hasher.update(document.date.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(content_hash(&document.text).as_bytes());
    hex::encode(hasher.finalize())
}

/// 索引目录是否存在（供 serve 启动检查）。
pub fn ensure_index_root(index_root: &Path) -> Result<()> {
    if !collection_path(index_root).is_dir() {
        bail!(
            "索引不存在：{}（先运行 search-server build）",
            collection_path(index_root).display()
        );
    }
    Ok(())
}
