//! Token 窗口切分与内容哈希。
//!
//! 默认 400 token 窗口 / 80 overlap；单篇最多 40 个 chunk。超过 40 个窗口时
//! 不再丢弃尾部，而是在 [0, len-window] 上等距取样 40 个窗口覆盖全文。
use sha2::{Digest, Sha256};
use tokenizers::Tokenizer;

use crate::content::SourceDocument;

pub const WINDOW_TOKENS: usize = 400;
pub const OVERLAP_TOKENS: usize = 80;
pub const MAX_CHUNKS_PER_DOC: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub index: usize,
    pub text: String,
    pub token_start: usize,
    pub token_end: usize,
}

/// 计算窗口起始 token 下标。
pub fn window_starts(len: usize, window: usize, overlap: usize, max_chunks: usize) -> Vec<usize> {
    assert!(window > 0, "window 必须为正");
    assert!(overlap < window, "overlap 必须小于 window");
    assert!(max_chunks > 0, "max_chunks 必须为正");
    if len == 0 {
        return Vec::new();
    }
    if len <= window {
        return vec![0];
    }

    let step = window - overlap;
    let last_start = len - window;
    let mut starts = Vec::new();
    let mut start = 0;
    loop {
        starts.push(start);
        if start >= last_start {
            break;
        }
        start = (start + step).min(last_start);
    }

    if starts.len() <= max_chunks {
        return starts;
    }

    // 超长文档：等距取样 max_chunks 个窗口，保留首尾覆盖。
    let span = last_start as f64;
    let mut sampled = Vec::with_capacity(max_chunks);
    for index in 0..max_chunks {
        let ratio = index as f64 / (max_chunks - 1) as f64;
        let start = (ratio * span).round() as usize;
        if sampled.last().copied() != Some(start) {
            sampled.push(start);
        }
    }
    sampled
}

/// 对全文（清洗后正文）计算 sha256，作为 parent 级内容指纹。
pub fn content_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    hex::encode(digest)
}

/// 用 E5 tokenizer 切 chunk；tokenizer 失败时退化为单 chunk。
pub fn chunk_document(tokenizer: &Tokenizer, document: &SourceDocument) -> Vec<Chunk> {
    let encoding = tokenizer.encode(document.text.as_str(), false);
    let Ok(encoding) = encoding else {
        return vec![Chunk {
            index: 0,
            text: document.text.clone(),
            token_start: 0,
            token_end: 0,
        }];
    };
    let ids = encoding.get_ids();
    let starts = window_starts(ids.len(), WINDOW_TOKENS, OVERLAP_TOKENS, MAX_CHUNKS_PER_DOC);
    let mut chunks = Vec::with_capacity(starts.len());

    for (index, start) in starts.into_iter().enumerate() {
        let end = (start + WINDOW_TOKENS).min(ids.len());
        let text = tokenizer
            .decode(&ids[start..end], true)
            .map(|text| text.trim().to_string())
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        chunks.push(Chunk {
            index,
            text,
            token_start: start,
            token_end: end,
        });
    }

    if chunks.is_empty() {
        chunks.push(Chunk {
            index: 0,
            text: document.text.clone(),
            token_start: 0,
            token_end: ids.len(),
        });
    }
    chunks
}

/// E5（sentence-transformers）官方要求的前缀。
pub fn passage_text(text: &str) -> String {
    format!("passage: {text}")
}

pub fn query_text(text: &str) -> String {
    format!("query: {text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_document_single_window() {
        assert_eq!(window_starts(100, 400, 80, 40), vec![0]);
        assert_eq!(window_starts(400, 400, 80, 40), vec![0]);
        assert!(window_starts(0, 400, 80, 40).is_empty());
    }

    #[test]
    fn normal_windows_follow_400_80() {
        // 1000 tokens：0..400、320..720、600..1000。
        assert_eq!(window_starts(1000, 400, 80, 40), vec![0, 320, 600]);
        assert_eq!(window_starts(500, 400, 80, 40), vec![0, 100]);
    }

    #[test]
    fn caps_long_documents_at_40_and_keeps_tail() {
        let starts = window_starts(60_000, 400, 80, 40);
        assert_eq!(starts.len(), 40);
        assert_eq!(starts.first().copied(), Some(0));
        assert_eq!(starts.last().copied(), Some(60_000 - 400));
        assert!(starts.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn window_end_never_exceeds_len() {
        for len in [401usize, 720, 721, 1040, 12_345] {
            for start in window_starts(len, 400, 80, 40) {
                assert!(start + 400 <= len);
            }
        }
    }

    #[test]
    fn content_hash_is_stable_and_distinct() {
        assert_eq!(content_hash("abc"), content_hash("abc"));
        assert_ne!(content_hash("abc"), content_hash("abd"));
        assert_eq!(
            content_hash(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn e5_prefixes() {
        assert_eq!(passage_text("x"), "passage: x");
        assert_eq!(query_text("y"), "query: y");
    }
}
