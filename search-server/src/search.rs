//! 查询过滤校验、RRF 融合分、结果归一化与 parentId 去重。
use std::collections::HashSet;

use anyhow::{bail, Result};

use crate::store::{Hit, SearchMode};

pub const RRF_RANK_CONSTANT: f32 = 60.0;

#[derive(Debug, Clone, Default)]
pub struct SearchFilters {
    pub apps: Vec<String>,
    pub exclude_apps: Vec<String>,
    pub tags: Vec<String>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
}

/// 校验后的过滤条件；SQL 参数只从这些值构造，避免表达式注入。
#[derive(Debug, Clone, Default)]
pub struct ValidatedFilters {
    pub apps: HashSet<String>,
    pub exclude_apps: HashSet<String>,
    /// 已编码为 `" tag "` 形式，保证整词匹配。
    pub tags: Vec<String>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
}

impl SearchFilters {
    pub fn validate(&self) -> Result<ValidatedFilters> {
        let apps = self
            .apps
            .iter()
            .map(|app| validate_app(app))
            .collect::<Result<HashSet<_>>>()?;
        let exclude_apps = self
            .exclude_apps
            .iter()
            .map(|app| validate_app(app))
            .collect::<Result<HashSet<_>>>()?;
        let tags = self
            .tags
            .iter()
            .map(|tag| validate_tag(tag).map(|tag| format!(" {tag} ")))
            .collect::<Result<Vec<_>>>()?;
        if let (Some(from), Some(to)) = (self.date_from, self.date_to) {
            if from > to {
                bail!("dateFrom 不能大于 dateTo");
            }
        }
        Ok(ValidatedFilters {
            apps,
            exclude_apps,
            tags,
            date_from: self.date_from,
            date_to: self.date_to,
        })
    }
}

impl ValidatedFilters {
    /// 与内存中的 chunk 元数据匹配（向量扫描路径）。
    pub fn matches(&self, app_id: &str, tags: &str, date: i64) -> bool {
        if !self.apps.is_empty() && !self.apps.contains(app_id) {
            return false;
        }
        if self.exclude_apps.contains(app_id) {
            return false;
        }
        if !self.tags.iter().all(|tag| tags.contains(tag.as_str())) {
            return false;
        }
        if let Some(from) = self.date_from {
            if date < from {
                return false;
            }
        }
        if let Some(to) = self.date_to {
            if date > to {
                return false;
            }
        }
        true
    }
}

/// 应用 id：字母数字、`-`、`.`。
fn validate_app(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '.'))
    {
        bail!("非法的 app 值：{value:?}（只允许字母数字、- 与 .）");
    }
    Ok(value.to_string())
}

/// 站点标签：在 app 规则上允许 `+`（C++）、`#`（C#）、`&`（html&css）。
///
/// 仍拒绝引号、反斜杠与 LIKE 通配符 `%`/`_`，避免匹配漂移。
fn validate_tag(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '.' | '+' | '#' | '&')
        })
    {
        bail!("非法的 tag 值：{value:?}（只允许字母数字、- . + # &）");
    }
    Ok(value.to_string())
}

/// 把 tags 列表编码为整词匹配字符串。
pub fn encode_tags(tags: &[String]) -> String {
    if tags.is_empty() {
        String::new()
    } else {
        format!(" {} ", tags.join(" "))
    }
}

/// 单路排名 → RRF 分（rank 从 0 开始）。
pub fn rrf_score(rank: usize) -> f32 {
    1.0 / (RRF_RANK_CONSTANT + rank as f32 + 1.0)
}

/// 向量余弦相似度 → [0, 1]。
pub fn normalize_vector_score(similarity: f32) -> f32 {
    similarity.clamp(0.0, 1.0)
}

/// RRF 融合分 → [0, 1]（两路召回、rank_constant=60 的理论最大值）。
pub fn normalize_hybrid_score(score: f32) -> f32 {
    let max = 2.0 / (RRF_RANK_CONSTANT + 1.0);
    (score / max).clamp(0.0, 1.0)
}

/// FTS 分是 BM25 类原始分，按当前结果集最大值归一化。
pub fn normalize_fts_scores(hits: &mut [ScoredHit]) {
    let max = hits.iter().map(|hit| hit.raw_score).fold(0.0f32, f32::max);
    if max <= 0.0 {
        for hit in hits {
            hit.score = 0.0;
        }
        return;
    }
    for hit in hits {
        hit.score = (hit.raw_score / max).clamp(0.0, 1.0);
    }
}

#[derive(Debug, Clone)]
pub struct ScoredHit {
    pub hit: Hit,
    pub raw_score: f32,
    pub score: f32,
}

impl ScoredHit {
    pub fn new(hit: Hit, mode: SearchMode) -> Self {
        let raw_score = hit.score;
        let score = match mode {
            SearchMode::Vector => normalize_vector_score(raw_score),
            SearchMode::Hybrid => normalize_hybrid_score(raw_score),
            SearchMode::Fts => raw_score,
        };
        Self {
            hit,
            raw_score,
            score,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DedupedResult {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub excerpt: String,
    pub href: String,
    pub date: i64,
    pub score: f32,
}

/// 按 parentId 去重（保留最高分 chunk），排序后切片。
pub fn dedupe_and_page(
    mut hits: Vec<ScoredHit>,
    offset: usize,
    limit: usize,
) -> (Vec<DedupedResult>, usize) {
    hits.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.hit.date.cmp(&left.hit.date))
            .then_with(|| left.hit.chunk_index.cmp(&right.hit.chunk_index))
            .then_with(|| left.hit.parent_id.cmp(&right.hit.parent_id))
    });

    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for hit in hits {
        if seen.insert(hit.hit.parent_id.clone()) {
            unique.push(hit);
        }
    }
    let total = unique.len();
    let results = unique
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|scored| DedupedResult {
            id: scored.hit.parent_id.clone(),
            app_name: app_name(&scored.hit.app_id).to_string(),
            app_id: scored.hit.app_id,
            title: scored.hit.title,
            excerpt: excerpt(&scored.hit.text, 160),
            href: scored.hit.href,
            date: scored.hit.date,
            score: scored.score,
        })
        .collect();
    (results, total)
}

pub fn app_name(app_id: &str) -> &'static str {
    match app_id {
        "event" => "事件",
        "articles" => "文章",
        _ => "内容",
    }
}

/// 截取前缀摘要（按 char 边界，避免切断 UTF-8）。
pub fn excerpt(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    let mut chars = text.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(parent: &str, score: f32, date: i64) -> Hit {
        Hit {
            doc_id: 0,
            parent_id: parent.to_string(),
            app_id: "event".to_string(),
            title: "标题".to_string(),
            date,
            chunk_index: 0,
            href: "/article/events/x".to_string(),
            text: "正文".to_string(),
            score,
        }
    }

    #[test]
    fn filter_validation_accepts_real_values() {
        let filters = SearchFilters {
            apps: vec!["event".into(), "articles".into()],
            exclude_apps: vec!["shout".into()],
            tags: vec!["C++".into(), "html&css".into(), "rust".into()],
            date_from: Some(1_000),
            date_to: Some(2_000),
        };
        let validated = filters.validate().unwrap();
        assert!(validated.matches("event", " rust C++ html&css ", 1_500));
        assert!(!validated.matches("shout", " rust C++ html&css ", 1_500));
        assert!(!validated.matches("event", " rust C++ ", 1_500));
        assert!(!validated.matches("event", " rust C++ html&css ", 2_001));
    }

    #[test]
    fn filter_rejects_injection_and_wildcards() {
        let filters = SearchFilters {
            apps: vec!["event' OR appId = 'articles".into()],
            ..Default::default()
        };
        assert!(filters.validate().is_err());

        let filters = SearchFilters {
            tags: vec!["a%b".into()],
            ..Default::default()
        };
        assert!(filters.validate().is_err());
    }

    #[test]
    fn filter_rejects_reversed_date_range() {
        let filters = SearchFilters {
            date_from: Some(10),
            date_to: Some(5),
            ..Default::default()
        };
        assert!(filters.validate().is_err());
    }

    #[test]
    fn empty_filter_matches_everything() {
        let filters = SearchFilters::default().validate().unwrap();
        assert!(filters.matches("event", "", 0));
    }

    #[test]
    fn tags_are_whole_word_encoded() {
        assert_eq!(encode_tags(&[]), "");
        assert_eq!(
            encode_tags(&["rust".to_string(), "ai".to_string()]),
            " rust ai "
        );
    }

    #[test]
    fn rrf_rank_zero_is_best() {
        assert!(rrf_score(0) > rrf_score(1));
        assert!((rrf_score(0) - 1.0 / 61.0).abs() < 1e-6);
    }

    #[test]
    fn vector_score_is_cosine_clamped() {
        assert_eq!(normalize_vector_score(1.0), 1.0);
        assert_eq!(normalize_vector_score(0.5), 0.5);
        assert_eq!(normalize_vector_score(-0.5), 0.0);
        assert_eq!(normalize_vector_score(2.0), 1.0);
    }

    #[test]
    fn hybrid_score_normalizes_to_unit() {
        let fused = rrf_score(0) + rrf_score(0);
        assert!((normalize_hybrid_score(fused) - 1.0).abs() < 1e-5);
        assert_eq!(normalize_hybrid_score(0.0), 0.0);
        assert_eq!(normalize_hybrid_score(1.0), 1.0);
    }

    #[test]
    fn dedupe_keeps_best_chunk_and_orders() {
        let scored = vec![
            ScoredHit::new(hit("a", 0.8, 10), SearchMode::Vector),
            ScoredHit::new(hit("b", 0.9, 20), SearchMode::Vector),
            ScoredHit::new(hit("a", 0.95, 10), SearchMode::Vector),
            ScoredHit::new(hit("c", 0.85, 30), SearchMode::Vector),
        ];
        let (results, total) = dedupe_and_page(scored, 0, 10);
        assert_eq!(total, 3);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].id, "a");
        assert!((results[0].score - 0.95).abs() < 1e-6);
        assert_eq!(results[1].id, "b");
        assert_eq!(results[2].id, "c");
    }

    #[test]
    fn dedupe_offset_and_limit() {
        let scored = (0..5)
            .map(|index| {
                ScoredHit::new(
                    hit(&format!("p{index}"), 0.1 + index as f32 * 0.1, 0),
                    SearchMode::Vector,
                )
            })
            .collect();
        let (results, total) = dedupe_and_page(scored, 1, 2);
        assert_eq!(total, 5);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "p3");
        assert_eq!(results[1].id, "p2");
    }

    #[test]
    fn fts_scores_are_relative() {
        let mut hits = vec![
            ScoredHit::new(hit("a", 2.0, 0), SearchMode::Fts),
            ScoredHit::new(hit("b", 4.0, 0), SearchMode::Fts),
        ];
        normalize_fts_scores(&mut hits);
        assert!((hits[0].score - 0.5).abs() < 1e-6);
        assert!((hits[1].score - 1.0).abs() < 1e-6);
    }

    #[test]
    fn excerpt_shows_ellipsis_only_when_truncated() {
        assert_eq!(excerpt("短文本", 10), "短文本");
        assert_eq!(excerpt("一二三四五", 3), "一二三…");
    }
}
