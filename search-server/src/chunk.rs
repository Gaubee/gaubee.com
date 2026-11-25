//! 字符窗口切分与内容哈希。
//!
//! 不再依赖本地 tokenizer：按 Unicode 字符窗口切分（默认 1600 字符 / 200
//! overlap，单篇最多 8 个 chunk）。超过 8 个窗口时不再丢弃尾部，而是在
//! [0, len-window] 上等距取样，保留首尾覆盖。1600 字符约对应 600–800 个
//! 中英混合 token，远低于主流 embedding 模型的 8192 token 上限。
use sha2::{Digest, Sha256};

pub const WINDOW_CHARS: usize = 1600;
pub const OVERLAP_CHARS: usize = 200;
pub const MAX_CHUNKS_PER_DOC: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub index: usize,
    pub text: String,
    /// 以字符计（不是 token），用于调试与增量比对。
    pub char_start: usize,
    pub char_end: usize,
}

/// 计算窗口起始字符下标。
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

/// 对清洗后的正文计算 sha256，作为 parent 级内容指纹。
pub fn content_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    hex::encode(digest)
}

/// 按字符窗口切 chunk；空文本返回空 Vec。
pub fn chunk_text(text: &str) -> Vec<Chunk> {
    let offsets = char_offsets(text);
    let total = offsets.len() - 1;
    let starts = window_starts(total, WINDOW_CHARS, OVERLAP_CHARS, MAX_CHUNKS_PER_DOC);
    let mut chunks = Vec::with_capacity(starts.len());

    for (index, start) in starts.into_iter().enumerate() {
        let end = (start + WINDOW_CHARS).min(total);
        let slice = &text[offsets[start]..offsets[end]];
        let trimmed = slice.trim();
        if trimmed.is_empty() {
            continue;
        }
        chunks.push(Chunk {
            index,
            text: trimmed.to_string(),
            char_start: start,
            char_end: end,
        });
    }

    chunks
}

/// 返回每个字符的字节起点，末尾追加 text.len()（含 len+1 个元素）。
fn char_offsets(text: &str) -> Vec<usize> {
    let mut offsets = text
        .char_indices()
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    offsets.push(text.len());
    offsets
}

/// 送 embedding 的文本由 `PromptProfile` 统一生成（见 `embed.rs`），
/// 这里只负责切分与指纹，不再拼标题。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_document_single_window() {
        assert_eq!(window_starts(100, 1600, 200, 8), vec![0]);
        assert_eq!(window_starts(1600, 1600, 200, 8), vec![0]);
        assert!(window_starts(0, 1600, 200, 8).is_empty());
    }

    #[test]
    fn normal_windows_follow_1600_200() {
        // 4000 字符：0..1600、1400..3000、2400..4000。
        assert_eq!(window_starts(4000, 1600, 200, 8), vec![0, 1400, 2400]);
        assert_eq!(window_starts(2000, 1600, 200, 8), vec![0, 400]);
    }

    #[test]
    fn caps_long_documents_and_keeps_tail() {
        let starts = window_starts(60_000, 1600, 200, 8);
        assert_eq!(starts.len(), 8);
        assert_eq!(starts.first().copied(), Some(0));
        assert_eq!(starts.last().copied(), Some(60_000 - 1600));
        assert!(starts.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn window_end_never_exceeds_len() {
        for len in [1601usize, 3000, 3001, 4400, 52_345] {
            for start in window_starts(len, 1600, 200, 8) {
                assert!(start + 1600 <= len);
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
    fn chunk_text_respects_utf8_boundaries() {
        let text = "中文😀abc".repeat(1000); // 每个重复 8 个字符
        let chunks = chunk_text(&text);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert!(!chunk.text.is_empty());
            assert!(chunk.char_end - chunk.char_start <= WINDOW_CHARS);
        }
        assert_eq!(chunks[0].char_start, 0);
    }

    #[test]
    fn chunk_text_short_and_empty() {
        assert!(chunk_text("").is_empty());
        let chunks = chunk_text("只有一句话");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "只有一句话");
    }
}
