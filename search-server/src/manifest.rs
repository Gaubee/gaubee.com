//! 索引根目录布局与构建清单。
//!
//! 布局：
//! ```text
//! index/
//!   collection/      zvec collection（dense HNSW + jieba FTS + 标量）
//!   manifest.json    构建清单（健康检查/增量 diff 用）
//! ```
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexManifest {
    pub version: u32,
    pub built_at: String,
    pub content_hash: String,
    pub documents: usize,
    pub chunks: usize,
    pub apps: std::collections::BTreeMap<String, usize>,
    pub model: String,
    pub zvec_version: String,
    pub embed_dim: usize,
    pub chunk_window: usize,
    pub chunk_overlap: usize,
    pub max_chunks_per_doc: usize,
}

impl IndexManifest {
    pub fn built_at_rfc3339(&self) -> &str {
        &self.built_at
    }
}

pub fn collection_path(index_root: &Path) -> PathBuf {
    index_root.join("collection")
}

pub fn manifest_path(index_root: &Path) -> PathBuf {
    index_root.join("manifest.json")
}

pub fn write_manifest(index_root: &Path, manifest: &IndexManifest) -> Result<()> {
    fs::create_dir_all(index_root)
        .with_context(|| format!("创建索引根目录失败：{}", index_root.display()))?;
    let path = manifest_path(index_root);
    let json = serde_json::to_string_pretty(manifest)?;
    fs::write(&path, json).with_context(|| format!("写入 manifest 失败：{}", path.display()))?;
    Ok(())
}

pub fn read_manifest(index_root: &Path) -> Result<Option<IndexManifest>> {
    let path = manifest_path(index_root);
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("读取 manifest 失败：{}", path.display()))?;
    let manifest = serde_json::from_str(&raw)
        .with_context(|| format!("解析 manifest 失败：{}", path.display()))?;
    Ok(Some(manifest))
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn directory_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}
