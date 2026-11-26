//! 索引构建清单（写入 SQLite `meta` 表，随索引一起分发）。
use std::collections::BTreeMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};

pub const FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexManifest {
    pub version: u32,
    pub built_at: String,
    pub content_hash: String,
    pub documents: usize,
    pub chunks: usize,
    pub apps: BTreeMap<String, usize>,
    pub model: String,
    pub embed_dim: usize,
    pub chunk_window_chars: usize,
    pub chunk_overlap_chars: usize,
    pub max_chunks_per_doc: usize,
}

impl IndexManifest {
    pub fn built_at_rfc3339(&self) -> &str {
        &self.built_at
    }
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
