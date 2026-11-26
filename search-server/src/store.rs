//! SQLite 单文件索引：docs + FTS5 + vectors，纯 Rust 查询路径。
//!
//! 布局：
//! - `docs`：chunk 级元数据与正文（text 给摘要，text_tokens 给 FTS5）；
//! - `docs_fts`：FTS5 外部内容表，中文由 jieba-rs 预分词后写入；
//! - `vectors`：doc_id + f32 LE embedding BLOB；
//! - `meta`：格式版本与 `IndexManifest` JSON。
//!
//! 启动时把全部向量加载为连续 `Vec<f32>`，查询用暴力余弦扫描；几万 chunk
//! 以内都是毫秒级，不需要 HNSW/ANN 运行时。
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use anyhow::{bail, Context, Result};
use jieba_rs::Jieba;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::manifest::IndexManifest;
use crate::search::{rrf_score, ValidatedFilters};

static JIEBA: LazyLock<Jieba> = LazyLock::new(Jieba::new);

const SCHEMA: &str = r#"
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE docs (
    id           INTEGER PRIMARY KEY,
    parent_id    TEXT NOT NULL,
    app_id       TEXT NOT NULL,
    title        TEXT NOT NULL,
    tags         TEXT NOT NULL,
    date         INTEGER NOT NULL,
    href         TEXT NOT NULL,
    chunk_index  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    text_tokens  TEXT NOT NULL,
    content_hash TEXT NOT NULL
);

CREATE INDEX idx_docs_parent ON docs(parent_id);
CREATE INDEX idx_docs_app_date ON docs(app_id, date);

CREATE VIRTUAL TABLE docs_fts USING fts5(
    text_tokens,
    content='docs',
    content_rowid='id',
    tokenize='unicode61'
);

CREATE TABLE vectors (
    doc_id    INTEGER PRIMARY KEY,
    embedding BLOB NOT NULL
);
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchMode {
    Hybrid,
    Vector,
    Fts,
}

impl SearchMode {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "" | "hybrid" => Ok(SearchMode::Hybrid),
            "vector" => Ok(SearchMode::Vector),
            "fts" | "fulltext" => Ok(SearchMode::Fts),
            other => bail!("不支持的 mode：{other}（可用 hybrid/vector/fts）"),
        }
    }
}

/// 一条待写入的 chunk。
#[derive(Debug, Clone)]
pub struct ChunkRecord<'a> {
    pub parent_id: &'a str,
    pub app_id: &'a str,
    pub title: &'a str,
    pub tags: &'a str,
    pub date: i64,
    pub chunk_index: i32,
    pub content_hash: &'a str,
    pub href: &'a str,
    pub text: &'a str,
    pub text_tokens: &'a str,
    pub embedding: &'a [f32],
}

/// 内存中的 chunk 元数据（摘要/过滤用）。
#[derive(Debug, Clone)]
pub struct ChunkMeta {
    pub doc_id: i64,
    pub parent_id: String,
    pub app_id: String,
    pub title: String,
    pub tags: String,
    pub date: i64,
    pub chunk_index: i32,
    pub href: String,
    pub text: String,
}

/// 一条检索命中（chunk 粒度）。
#[derive(Debug, Clone)]
pub struct Hit {
    pub doc_id: i64,
    pub parent_id: String,
    pub app_id: String,
    pub title: String,
    pub date: i64,
    pub chunk_index: i32,
    pub href: String,
    pub text: String,
    pub score: f32,
}

/// 可复用向量表：`(parent_id, chunk_index) -> (content_hash, embedding)`。
pub type ReusableVectors = std::collections::HashMap<(String, i32), (String, Vec<f32>)>;

/// 从已存在的索引里载出可复用向量。
///
/// 增量重建用：同一 parent 的 content_hash 没变、chunk 序号也没变时，向量可以原样
/// 复用（embedding 只依赖标题+正文+前缀模板，三者都没变就必然同值）。索引不存在
/// 或读不出来时返回空表，调用方自然退化为全量重建。
pub fn load_reusable_vectors(path: &Path) -> Result<ReusableVectors> {
    let mut reusable = ReusableVectors::new();
    if !path.is_file() {
        return Ok(reusable);
    }
    let connection = match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => connection,
        Err(_) => return Ok(reusable),
    };
    let mut statement = match connection.prepare(
        "SELECT d.parent_id, d.chunk_index, d.content_hash, v.embedding
         FROM docs d JOIN vectors v ON v.doc_id = d.id",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(reusable),
    };
    let mut query_rows = match statement.query([]) {
        Ok(query_rows) => query_rows,
        Err(_) => return Ok(reusable),
    };
    loop {
        let row = match query_rows.next() {
            Ok(Some(row)) => row,
            // 读到尾或中途出错都停止：增量只是优化，读到一半也算部分复用。
            Ok(None) | Err(_) => break,
        };
        let parent_id: String = row.get(0)?;
        let chunk_index: i32 = row.get(1)?;
        let content_hash: String = row.get(2)?;
        let blob: Vec<u8> = row.get(3)?;
        if let Ok(vector) = decode_vector(&blob) {
            reusable.insert((parent_id, chunk_index), (content_hash, vector));
        }
    }
    Ok(reusable)
}

/// 写入索引文件（先写临时文件，成功后原子重命名，失败不破坏旧索引）。
pub fn write_index(
    path: &Path,
    records: &[ChunkRecord<'_>],
    manifest: &IndexManifest,
) -> Result<u64> {
    if records.is_empty() {
        bail!("拒绝写入空索引");
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .with_context(|| format!("创建索引目录失败：{}", parent.display()))?;
    let temp = temp_path(path);
    let _ = fs::remove_file(&temp);

    let outcome = write_index_inner(&temp, records, manifest);
    match outcome {
        Ok(bytes) => {
            fs::rename(&temp, path).with_context(|| {
                format!("原子替换索引失败：{} -> {}", temp.display(), path.display())
            })?;
            Ok(bytes)
        }
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("index.sqlite");
    path.with_file_name(format!(".{file_name}.tmp-{}", std::process::id()))
}

fn write_index_inner(
    path: &Path,
    records: &[ChunkRecord<'_>],
    manifest: &IndexManifest,
) -> Result<u64> {
    let mut connection = Connection::open(path)
        .with_context(|| format!("创建 SQLite 索引失败：{}", path.display()))?;
    connection.execute_batch(
        "PRAGMA journal_mode=DELETE;
         PRAGMA synchronous=OFF;
         PRAGMA temp_store=MEMORY;
         PRAGMA cache_size=-65536;",
    )?;
    connection
        .execute_batch(SCHEMA)
        .context("创建索引表结构失败")?;

    {
        let transaction = connection.transaction()?;
        {
            let mut insert_doc = transaction.prepare(
                "INSERT INTO docs (
                    parent_id, app_id, title, tags, date, href,
                    chunk_index, text, text_tokens, content_hash
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;
            let mut insert_fts =
                transaction.prepare("INSERT INTO docs_fts(rowid, text_tokens) VALUES (?, ?)")?;
            let mut insert_vector =
                transaction.prepare("INSERT INTO vectors(doc_id, embedding) VALUES (?, ?)")?;

            for record in records {
                insert_doc.execute(params![
                    record.parent_id,
                    record.app_id,
                    record.title,
                    record.tags,
                    record.date,
                    record.href,
                    record.chunk_index,
                    record.text,
                    record.text_tokens,
                    record.content_hash,
                ])?;
                let doc_id = transaction.last_insert_rowid();
                insert_fts.execute(params![doc_id, record.text_tokens])?;
                insert_vector.execute(params![doc_id, encode_vector(record.embedding)])?;
            }
        }
        transaction.commit()?;
    }

    connection.execute_batch("INSERT INTO docs_fts(docs_fts) VALUES('optimize');")?;
    connection.execute_batch("PRAGMA optimize; ANALYZE;")?;
    connection.execute(
        "INSERT INTO meta(key, value) VALUES ('formatVersion', ?1)",
        [crate::manifest::FORMAT_VERSION.to_string()],
    )?;
    connection.execute(
        "INSERT INTO meta(key, value) VALUES ('manifest', ?1)",
        [serde_json::to_string(manifest)?],
    )?;
    connection.execute_batch("VACUUM;")?;

    let count: i64 = connection.query_row("SELECT COUNT(*) FROM docs", [], |row| row.get(0))?;
    if count as usize != records.len() {
        bail!("索引写入数量校验失败：{count} != {}", records.len());
    }
    drop(connection);
    Ok(fs::metadata(path)?.len())
}

fn encode_vector(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_vector(blob: &[u8]) -> Result<Vec<f32>> {
    if !blob.len().is_multiple_of(4) {
        bail!("embedding BLOB 长度非法：{}", blob.len());
    }
    Ok(blob
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect())
}

pub struct LoadedIndex {
    connection: Mutex<Connection>,
    chunks: Vec<ChunkMeta>,
    vectors: Vec<f32>,
    dim: usize,
    manifest: IndexManifest,
    path: PathBuf,
}

impl LoadedIndex {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .with_context(|| format!("打开索引失败：{}", path.display()))?;
        connection.busy_timeout(std::time::Duration::from_millis(2_000))?;

        let manifest_json: Option<String> = connection
            .query_row("SELECT value FROM meta WHERE key = 'manifest'", [], |row| {
                row.get(0)
            })
            .optional()?;
        let manifest_json = manifest_json.context("索引缺少 manifest 元数据（版本过旧？）")?;
        let manifest: IndexManifest =
            serde_json::from_str(&manifest_json).context("解析索引 manifest 失败")?;
        if manifest.version != crate::manifest::FORMAT_VERSION {
            bail!(
                "索引格式版本不支持：{}（期望 {}），请重建",
                manifest.version,
                crate::manifest::FORMAT_VERSION
            );
        }
        if manifest.embed_dim == 0 {
            bail!("索引 embedDim 非法：0");
        }

        let mut statement = connection.prepare(
            "SELECT d.id, d.parent_id, d.app_id, d.title, d.tags, d.date,
                    d.chunk_index, d.href, d.text, v.embedding
             FROM docs d JOIN vectors v ON v.doc_id = d.id
             ORDER BY d.id",
        )?;
        let mut rows = statement.query([])?;
        let dim = manifest.embed_dim;
        let mut chunks = Vec::new();
        let mut vectors = Vec::new();
        while let Some(row) = rows.next()? {
            let blob: Vec<u8> = row.get(9)?;
            if blob.len() != dim * 4 {
                bail!(
                    "向量维度不匹配：期望 {dim} 维（{} 字节），实际 {} 字节",
                    dim * 4,
                    blob.len()
                );
            }
            vectors.extend(decode_vector(&blob)?);
            chunks.push(ChunkMeta {
                doc_id: row.get(0)?,
                parent_id: row.get(1)?,
                app_id: row.get(2)?,
                title: row.get(3)?,
                tags: row.get(4)?,
                date: row.get(5)?,
                chunk_index: row.get(6)?,
                href: row.get(7)?,
                text: row.get(8)?,
            });
        }
        if chunks.is_empty() {
            bail!("索引为空：{}", path.display());
        }
        if vectors.len() != chunks.len() * dim {
            bail!("向量总数与 chunk 数不匹配");
        }
        drop(rows);
        drop(statement);
        Ok(Self {
            connection: Mutex::new(connection),
            chunks,
            vectors,
            dim,
            manifest,
            path: path.to_path_buf(),
        })
    }

    pub fn manifest(&self) -> &IndexManifest {
        &self.manifest
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    pub fn document_count(&self) -> usize {
        self.chunks
            .iter()
            .map(|chunk| chunk.parent_id.as_str())
            .collect::<HashSet<_>>()
            .len()
    }

    pub fn search(
        &self,
        mode: SearchMode,
        embedding: Option<&[f32]>,
        query: &str,
        filters: &ValidatedFilters,
        topk: usize,
    ) -> Result<Vec<Hit>> {
        let topk = topk.clamp(1, 1_000);
        match mode {
            SearchMode::Fts => self.fts_search(query, filters, topk),
            SearchMode::Vector => {
                let embedding = embedding.context("vector 检索缺少 query embedding")?;
                self.vector_search(embedding, filters, topk)
            }
            SearchMode::Hybrid => {
                let embedding = embedding.context("hybrid 检索缺少 query embedding")?;
                self.hybrid_search(embedding, query, filters, topk)
            }
        }
    }

    fn fts_search(&self, query: &str, filters: &ValidatedFilters, topk: usize) -> Result<Vec<Hit>> {
        let Some(expression) = fts_match_expression(query) else {
            return Ok(Vec::new());
        };

        let mut sql = String::from(
            "SELECT d.id, d.parent_id, d.app_id, d.title, d.date,
                    d.chunk_index, d.href, d.text, -bm25(docs_fts) AS score
             FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
             WHERE docs_fts MATCH ?",
        );
        let mut values: Vec<Value> = vec![Value::Text(expression)];

        if !filters.apps.is_empty() {
            sql.push_str(&in_clause(" AND d.app_id IN (", filters.apps.len()));
            for app in &filters.apps {
                values.push(Value::Text(app.clone()));
            }
        }
        if !filters.exclude_apps.is_empty() {
            sql.push_str(&in_clause(
                " AND d.app_id NOT IN (",
                filters.exclude_apps.len(),
            ));
            for app in &filters.exclude_apps {
                values.push(Value::Text(app.clone()));
            }
        }
        for tag in &filters.tags {
            sql.push_str(" AND instr(d.tags, ?) > 0");
            values.push(Value::Text(tag.clone()));
        }
        if let Some(date) = filters.date_from {
            sql.push_str(" AND d.date >= ?");
            values.push(Value::Integer(date));
        }
        if let Some(date) = filters.date_to {
            sql.push_str(" AND d.date <= ?");
            values.push(Value::Integer(date));
        }
        sql.push_str(" ORDER BY bm25(docs_fts) ASC LIMIT ?");
        values.push(Value::Integer(topk as i64));

        let connection = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("索引连接锁中毒"))?;
        let mut statement = connection.prepare(&sql)?;
        let mut rows = statement.query(params_from_iter(values.iter()))?;
        let mut hits = Vec::new();
        while let Some(row) = rows.next()? {
            let score: f64 = row.get(8)?;
            hits.push(Hit {
                doc_id: row.get(0)?,
                parent_id: row.get(1)?,
                app_id: row.get(2)?,
                title: row.get(3)?,
                date: row.get(4)?,
                chunk_index: row.get(5)?,
                href: row.get(6)?,
                text: row.get(7)?,
                score: score.max(0.0) as f32,
            });
        }
        Ok(hits)
    }

    fn vector_search(
        &self,
        embedding: &[f32],
        filters: &ValidatedFilters,
        topk: usize,
    ) -> Result<Vec<Hit>> {
        if embedding.len() != self.dim {
            bail!(
                "query embedding 维度不匹配：期望 {}，实际 {}",
                self.dim,
                embedding.len()
            );
        }
        let norm = embedding
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        if norm <= 1e-12 {
            return Ok(Vec::new());
        }
        let scale = 1.0 / norm;

        let mut candidates: Vec<(f32, usize)> = Vec::new();
        for (index, chunk) in self.chunks.iter().enumerate() {
            if !filters.matches(&chunk.app_id, &chunk.tags, chunk.date) {
                continue;
            }
            let base = index * self.dim;
            let slice = &self.vectors[base..base + self.dim];
            let similarity = dot(slice, embedding) * scale;
            if similarity.is_finite() {
                candidates.push((similarity, index));
            }
        }
        candidates.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.1.cmp(&right.1))
        });
        candidates.truncate(topk);
        Ok(candidates
            .into_iter()
            .map(|(score, index)| hit_from_meta(&self.chunks[index], score))
            .collect())
    }

    fn hybrid_search(
        &self,
        embedding: &[f32],
        query: &str,
        filters: &ValidatedFilters,
        topk: usize,
    ) -> Result<Vec<Hit>> {
        let fts_hits = self.fts_search(query, filters, topk)?;
        let vector_hits = self.vector_search(embedding, filters, topk)?;

        let mut merged: HashMap<i64, (Hit, f32)> = HashMap::new();
        for (rank, hit) in fts_hits.into_iter().enumerate() {
            let score = rrf_score(rank);
            merged.entry(hit.doc_id).or_insert((hit, 0.0)).1 += score;
        }
        for (rank, hit) in vector_hits.into_iter().enumerate() {
            let score = rrf_score(rank);
            merged.entry(hit.doc_id).or_insert((hit, 0.0)).1 += score;
        }

        let mut hits = merged.into_values().collect::<Vec<_>>();
        hits.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| right.0.date.cmp(&left.0.date))
                .then_with(|| left.0.chunk_index.cmp(&right.0.chunk_index))
                .then_with(|| left.0.parent_id.cmp(&right.0.parent_id))
        });
        Ok(hits
            .into_iter()
            .map(|(mut hit, score)| {
                hit.score = score;
                hit
            })
            .collect())
    }
}

fn in_clause(prefix: &str, count: usize) -> String {
    let placeholders = std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",");
    format!("{prefix}{placeholders})")
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| left * right)
        .sum()
}

fn hit_from_meta(meta: &ChunkMeta, score: f32) -> Hit {
    Hit {
        doc_id: meta.doc_id,
        parent_id: meta.parent_id.clone(),
        app_id: meta.app_id.clone(),
        title: meta.title.clone(),
        date: meta.date,
        chunk_index: meta.chunk_index,
        href: meta.href.clone(),
        text: meta.text.clone(),
        score,
    }
}

/// 读取索引 manifest（仅测试/诊断用；check 走 `verify_index_integrity` 一次拿全）。
#[cfg(test)]
pub fn read_index_manifest(path: &Path) -> Result<Option<IndexManifest>> {
    if !path.is_file() {
        return Ok(None);
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("打开索引失败：{}", path.display()))?;
    let manifest_json: Option<String> = connection
        .query_row("SELECT value FROM meta WHERE key = 'manifest'", [], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(json) = manifest_json else {
        return Ok(None);
    };
    let manifest: IndexManifest = serde_json::from_str(&json).context("解析索引 manifest 失败")?;
    Ok(Some(manifest))
}

/// 读取索引内容指纹（历史接口，保留给测试/诊断）。
#[cfg(test)]
pub fn read_content_hash(path: &Path) -> Result<Option<String>> {
    Ok(read_index_manifest(path)?.map(|manifest| manifest.content_hash))
}

/// 轻量校验索引：文件存在、SQLite 可打开、格式版本、表结构、行数与向量长度。
///
/// 只做只读探测，不读取向量内容，也不走 `LoadedIndex::open` 的全量加载路径；
/// 供 `check` 子命令在容器 entrypoint 里低成本判断索引是否可用。
/// 通过时返回 manifest，失败时返回可直接展示的中文原因。
pub fn verify_index_integrity(path: &Path) -> Result<IndexManifest> {
    let metadata =
        fs::metadata(path).with_context(|| format!("索引文件不存在：{}", path.display()))?;
    if metadata.len() == 0 {
        bail!("索引文件为空（0 字节）：{}", path.display());
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("打开索引失败（文件可能已损坏）：{}", path.display()))?;

    let format_version: Option<String> = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'formatVersion'",
            [],
            |row| row.get(0),
        )
        .optional()
        .context("读取索引 meta.formatVersion 失败（表结构可能损坏）")?;
    let format_version = format_version.context("索引缺少 meta.formatVersion（版本过旧？）")?;
    let parsed = format_version
        .trim()
        .parse::<u32>()
        .with_context(|| format!("索引 meta.formatVersion 非法：{format_version:?}"))?;
    if parsed != crate::manifest::FORMAT_VERSION {
        bail!(
            "索引格式版本不支持：{parsed}（期望 {}），请重建",
            crate::manifest::FORMAT_VERSION
        );
    }

    let manifest_json: Option<String> = connection
        .query_row("SELECT value FROM meta WHERE key = 'manifest'", [], |row| {
            row.get(0)
        })
        .optional()
        .context("读取索引 manifest 失败（表结构可能损坏）")?;
    let manifest_json = manifest_json.context("索引缺少 manifest 元数据（版本过旧？）")?;
    let manifest: IndexManifest =
        serde_json::from_str(&manifest_json).context("解析索引 manifest 失败（元数据已损坏）")?;
    if manifest.version != crate::manifest::FORMAT_VERSION {
        bail!(
            "索引 manifest 版本不支持：{}（期望 {}），请重建",
            manifest.version,
            crate::manifest::FORMAT_VERSION
        );
    }
    if manifest.embed_dim == 0 {
        bail!("索引 embedDim 非法：0");
    }

    for table in ["docs", "vectors"] {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .context("读取索引表结构失败（sqlite_master 已损坏）")?;
        if present == 0 {
            bail!("索引缺少必需的表：{table}");
        }
    }

    let docs: i64 = connection
        .query_row("SELECT COUNT(*) FROM docs", [], |row| row.get(0))
        .context("统计 docs 行数失败（表已损坏）")?;
    let vectors: i64 = connection
        .query_row("SELECT COUNT(*) FROM vectors", [], |row| row.get(0))
        .context("统计 vectors 行数失败（表已损坏）")?;
    if docs == 0 {
        bail!("索引内容为空：docs 表 0 行");
    }
    if docs != vectors {
        bail!("docs 与 vectors 行数不一致：docs={docs}，vectors={vectors}");
    }
    let paired: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM docs JOIN vectors ON vectors.doc_id = docs.id",
            [],
            |row| row.get(0),
        )
        .context("统计 docs/vectors 对应关系失败（表已损坏）")?;
    if paired != vectors {
        bail!("docs 与 vectors 未一一对应：vectors={vectors}，可配对 {paired}");
    }

    let expected_bytes = i64::try_from(manifest.embed_dim * 4).context("索引 embedDim 过大")?;
    let mut statement = connection.prepare(
        "SELECT doc_id, length(embedding) FROM vectors WHERE length(embedding) != ?1 LIMIT 1",
    )?;
    let mut rows = statement.query([expected_bytes])?;
    if let Some(row) = rows.next()? {
        let doc_id: i64 = row.get(0)?;
        let actual: i64 = row.get(1)?;
        bail!(
            "向量长度与 embedDim 不匹配：doc_id={doc_id} 期望 {expected_bytes} 字节（{} 维），实际 {actual} 字节",
            manifest.embed_dim
        );
    }
    drop(rows);
    drop(statement);

    // quick_check 只扫主结构，不逐条解码向量，几万 chunk 仍是毫秒级。
    let mut statement = connection.prepare("PRAGMA quick_check")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let result: String = row.get(0)?;
        if !result.eq_ignore_ascii_case("ok") {
            bail!("索引完整性校验失败（PRAGMA quick_check）：{result}");
        }
    }
    Ok(manifest)
}

/// jieba 预分词：保留含字母/数字/汉字的 token，丢弃纯标点与空白。
pub fn fts_tokens(text: &str) -> Vec<String> {
    JIEBA
        .cut(text, true)
        .into_iter()
        .map(str::trim)
        .filter(|token| {
            !token.is_empty() && token.chars().any(|character| character.is_alphanumeric())
        })
        .map(ToOwned::to_owned)
        .collect()
}

pub fn tokenize_for_index(text: &str) -> String {
    fts_tokens(text).join(" ")
}

/// 预热 jieba 词典（约 44 MB 常驻），避免首个查询承担加载延迟。
pub fn warmup() {
    let _ = fts_tokens("预热 warmup");
}

/// 构造 FTS5 MATCH 表达式：每个 token 加双引号，OR 连接；空结果返回 None。
pub fn fts_match_expression(query: &str) -> Option<String> {
    let tokens = fts_tokens(query);
    if tokens.is_empty() {
        return None;
    }
    Some(
        tokens
            .iter()
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

/// parent 级内容指纹：标题/标签/日期/正文任一变化都会改变。
pub fn document_hash(title: &str, tags: &[String], date: i64, text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hasher.update(b"\0");
    hasher.update(tags.join(",").as_bytes());
    hasher.update(b"\0");
    hasher.update(date.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(crate::chunk::content_hash(text).as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{IndexManifest, FORMAT_VERSION};

    fn manifest(dim: usize) -> IndexManifest {
        IndexManifest {
            version: FORMAT_VERSION,
            built_at: "2026-01-01T00:00:00.000Z".to_string(),
            content_hash: "test-hash".to_string(),
            documents: 2,
            chunks: 2,
            apps: Default::default(),
            model: "mock".to_string(),
            embed_dim: dim,
            chunk_window_chars: crate::chunk::WINDOW_CHARS,
            chunk_overlap_chars: crate::chunk::OVERLAP_CHARS,
            max_chunks_per_doc: crate::chunk::MAX_CHUNKS_PER_DOC,
        }
    }

    fn vector(values: [f32; 3]) -> Vec<f32> {
        let mut vector = values.to_vec();
        crate::embed::l2_normalize(&mut vector);
        vector
    }

    fn build_temp() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("index.sqlite");
        let vector_a = vector([1.0, 0.0, 0.0]);
        let vector_b = vector([0.0, 1.0, 0.0]);
        // tokenize_for_index 返回临时 String，record() 里借用会悬垂；
        // 这里显式持有 token 字符串。
        let tokens_a = tokenize_for_index("Rust 异步运行时 tokio");
        let tokens_b = tokenize_for_index("向量数据库 hnsw semantic search");
        let records = [
            ChunkRecord {
                parent_id: "parent-a",
                app_id: "event",
                title: "Rust 异步运行时",
                tags: " rust ",
                date: 1_700_000_000_000,
                chunk_index: 0,
                content_hash: "hash-a",
                href: "/article/events/a",
                text: "Rust 异步运行时 tokio concurrency",
                text_tokens: &tokens_a,
                embedding: &vector_a,
            },
            ChunkRecord {
                parent_id: "parent-b",
                app_id: "articles",
                title: "向量数据库",
                tags: " database ",
                date: 1_600_000_000_000,
                chunk_index: 0,
                content_hash: "hash-b",
                href: "/article/articles/b",
                text: "vector database hnsw semantic search",
                text_tokens: &tokens_b,
                embedding: &vector_b,
            },
        ];
        write_index(&path, &records, &manifest(3)).expect("write index");
        (dir, path)
    }

    #[test]
    fn fts_chinese_and_english_tokens() {
        let tokens = fts_tokens("Rust 异步运行时 tokio，C++ 与 C#");
        assert!(tokens.iter().any(|token| token == "Rust"));
        assert!(tokens
            .iter()
            .any(|token| token == "异步" || token == "异步运行时"));
        assert!(tokens.iter().any(|token| token == "tokio"));
        assert!(tokens
            .iter()
            .any(|token| token.starts_with('C') && token.len() <= 3));
        assert!(fts_match_expression("什麼都不匹配").is_some());
        assert!(fts_match_expression("!!! ...").is_none());
    }

    #[test]
    fn fts_match_expression_quotes_tokens() {
        assert_eq!(
            fts_match_expression("rust tokio"),
            Some("\"rust\" OR \"tokio\"".to_string())
        );
    }

    #[test]
    fn roundtrip_vector_fts_hybrid_and_filter() {
        let (_dir, path) = build_temp();
        let index = LoadedIndex::open(&path).expect("open");
        assert_eq!(index.dim(), 3);
        assert_eq!(index.chunk_count(), 2);
        assert_eq!(index.document_count(), 2);
        assert_eq!(
            read_content_hash(&path).unwrap().as_deref(),
            Some("test-hash")
        );

        let query = vector([1.0, 0.0, 0.0]);
        let filters = ValidatedFilters::default();

        let hits = index
            .search(SearchMode::Vector, Some(&query), "unused", &filters, 5)
            .expect("vector");
        assert_eq!(hits[0].parent_id, "parent-a");
        assert!((hits[0].score - 1.0).abs() < 1e-5);

        let hits = index
            .search(SearchMode::Fts, None, "异步", &filters, 5)
            .expect("fts");
        assert_eq!(hits[0].parent_id, "parent-a");
        assert!(hits[0].score > 0.0);

        let hits = index
            .search(SearchMode::Fts, None, "semantic", &filters, 5)
            .expect("fts-en");
        assert_eq!(hits[0].parent_id, "parent-b");

        let hits = index
            .search(SearchMode::Hybrid, Some(&query), "semantic", &filters, 5)
            .expect("hybrid");
        // parent-b 同时命中 FTS rank0 与向量 rank1，RRF 分应高于只命中单路的 parent-a。
        assert_eq!(hits[0].parent_id, "parent-b");
        assert!(hits.iter().any(|hit| hit.parent_id == "parent-a"));

        let mut app_filter = ValidatedFilters::default();
        app_filter.apps.insert("articles".to_string());
        let hits = index
            .search(SearchMode::Vector, Some(&query), "unused", &app_filter, 5)
            .expect("app filter");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].parent_id, "parent-b");

        let mut tag_filter = ValidatedFilters::default();
        tag_filter.tags.push(" rust ".to_string());
        let hits = index
            .search(SearchMode::Vector, Some(&query), "unused", &tag_filter, 5)
            .expect("tag filter");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].parent_id, "parent-a");

        let date_filter = ValidatedFilters {
            date_from: Some(1_650_000_000_000),
            ..Default::default()
        };
        let hits = index
            .search(SearchMode::Fts, None, "semantic", &date_filter, 5)
            .expect("date filter");
        assert!(hits.is_empty());
    }

    #[test]
    fn empty_special_query_returns_no_fts_hits() {
        let (_dir, path) = build_temp();
        let index = LoadedIndex::open(&path).expect("open");
        let filters = ValidatedFilters::default();
        assert!(index
            .search(SearchMode::Fts, None, "!!! ...", &filters, 5)
            .unwrap()
            .is_empty());
        assert!(index
            .search(SearchMode::Fts, None, "", &filters, 5)
            .unwrap()
            .is_empty());
        assert!(index
            .search(SearchMode::Fts, None, "\"", &filters, 5)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_missing_or_corrupt_index() {
        let dir = tempfile::tempdir().unwrap();
        assert!(LoadedIndex::open(&dir.path().join("missing.sqlite")).is_err());
        assert_eq!(
            read_content_hash(&dir.path().join("missing.sqlite")).unwrap(),
            None
        );
    }

    #[test]
    fn integrity_accepts_fresh_index() {
        let (_dir, path) = build_temp();
        let manifest = verify_index_integrity(&path).expect("fresh index passes");
        assert_eq!(manifest.embed_dim, 3);
        assert_eq!(manifest.version, FORMAT_VERSION);
    }

    #[test]
    fn integrity_rejects_unsupported_format_version() {
        let (_dir, path) = build_temp();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE meta SET value = '99' WHERE key = 'formatVersion'",
                [],
            )
            .unwrap();
        drop(connection);
        let error = verify_index_integrity(&path).unwrap_err();
        assert!(error.to_string().contains("格式版本不支持"), "{error:#}");
    }

    #[test]
    fn integrity_rejects_missing_manifest() {
        let (_dir, path) = build_temp();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute("DELETE FROM meta WHERE key = 'manifest'", [])
            .unwrap();
        drop(connection);
        let error = verify_index_integrity(&path).unwrap_err();
        assert!(error.to_string().contains("缺少 manifest"), "{error:#}");
    }

    #[test]
    fn integrity_rejects_truncated_vector_blob() {
        let (_dir, path) = build_temp();
        let connection = Connection::open(&path).unwrap();
        // 3 维 f32 应为 12 字节；截成 8 字节模拟写入损坏。
        connection
            .execute(
                "UPDATE vectors SET embedding = zeroblob(8) WHERE doc_id = (SELECT MIN(doc_id) FROM vectors)",
                [],
            )
            .unwrap();
        drop(connection);
        let error = verify_index_integrity(&path).unwrap_err();
        assert!(error.to_string().contains("向量长度"), "{error:#}");
    }

    #[test]
    fn integrity_rejects_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.sqlite");
        std::fs::write(&path, b"").unwrap();
        let error = verify_index_integrity(&path).unwrap_err();
        assert!(error.to_string().contains("为空"), "{error:#}");
    }

    #[test]
    fn integrity_rejects_vector_row_count_mismatch() {
        let (_dir, path) = build_temp();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "DELETE FROM vectors WHERE doc_id = (SELECT MAX(doc_id) FROM vectors)",
                [],
            )
            .unwrap();
        drop(connection);
        let error = verify_index_integrity(&path).unwrap_err();
        assert!(error.to_string().contains("行数不一致"), "{error:#}");
    }
}
