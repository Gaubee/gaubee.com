//! 查询过滤表达式、结果打分归一化与 parentId 去重。
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

/// 生成 zvec 过滤表达式；空过滤返回 None。
///
/// 值域只允许 `[A-Za-z0-9.-]`（应用 id 与站点标签的实际形态），拒绝引号、
/// 通配符与反斜杠，避免表达式注入和 LIKE 语义漂移。
pub fn build_filter(filters: &SearchFilters) -> Result<Option<String>> {
    let mut clauses = Vec::new();

    if !filters.apps.is_empty() {
        let values = filters
            .apps
            .iter()
            .map(|app| validate_app(app))
            .collect::<Result<Vec<_>>>()?;
        clauses.push(format!(
            "({})",
            values
                .iter()
                .map(|app| format!("appId = '{app}'"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    for app in &filters.exclude_apps {
        let app = validate_app(app)?;
        clauses.push(format!("appId != '{app}'"));
    }

    for tag in &filters.tags {
        let tag = validate_tag(tag)?;
        // tags 存储为 " tag1 tag2 "（前后带空格），保证整词匹配。
        clauses.push(format!("tags LIKE '% {tag} %'"));
    }

    if let Some(date) = filters.date_from {
        clauses.push(format!("date >= {date}"));
    }
    if let Some(date) = filters.date_to {
        clauses.push(format!("date <= {date}"));
    }
    if let (Some(from), Some(to)) = (filters.date_from, filters.date_to) {
        if from > to {
            bail!("dateFrom 不能大于 dateTo");
        }
    }

    Ok(if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    })
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

/// 站点标签：在上面的基础上允许 `+`（C++）、`#`（C#）、`&`（html&css）。
///
/// 仍拒绝引号、反斜杠与 LIKE 通配符 `%`/`_`，避免表达式注入与匹配漂移。
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

/// COSINE 距离 → 相似度。
pub fn normalize_vector_score(distance: f32) -> f32 {
    (1.0 - distance).clamp(0.0, 1.0)
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

    let mut seen = std::collections::HashSet::new();
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
    fn filter_maps_apps_tabs_and_dates() {
        let filter = SearchFilters {
            apps: vec!["event".into(), "articles".into()],
            exclude_apps: vec!["shout".into()],
            tags: vec!["rust".into()],
            date_from: Some(1_000),
            date_to: Some(2_000),
        };
        let expression = build_filter(&filter).unwrap().unwrap();
        assert_eq!(
            expression,
            "(appId = 'event' OR appId = 'articles') AND appId != 'shout' AND tags LIKE '% rust %' AND date >= 1000 AND date <= 2000"
        );
    }

    #[test]
    fn empty_filter_is_none() {
        assert!(build_filter(&SearchFilters::default()).unwrap().is_none());
    }

    #[test]
    fn rejects_injection_and_wildcards() {
        let filter = SearchFilters {
            apps: vec!["event' OR appId = 'articles".into()],
            ..Default::default()
        };
        assert!(build_filter(&filter).is_err());

        let filter = SearchFilters {
            tags: vec!["a%b".into()],
            ..Default::default()
        };
        assert!(build_filter(&filter).is_err());
    }

    #[test]
    fn accepts_real_site_tags() {
        let filter = SearchFilters {
            tags: vec!["C++".into(), "html&css".into(), "agent-tooling".into()],
            ..Default::default()
        };
        let expression = build_filter(&filter).unwrap().unwrap();
        assert_eq!(
            expression,
            "tags LIKE '% C++ %' AND tags LIKE '% html&css %' AND tags LIKE '% agent-tooling %'"
        );
    }

    #[test]
    fn rejects_reversed_date_range() {
        let filter = SearchFilters {
            date_from: Some(10),
            date_to: Some(5),
            ..Default::default()
        };
        assert!(build_filter(&filter).is_err());
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
    fn vector_score_is_one_minus_distance() {
        assert!((normalize_vector_score(0.0) - 1.0).abs() < 1e-6);
        assert!((normalize_vector_score(1.0) - 0.0).abs() < 1e-6);
        assert_eq!(normalize_vector_score(-0.5), 1.0);
        assert_eq!(normalize_vector_score(2.0), 0.0);
    }

    #[test]
    fn hybrid_score_normalizes_to_unit() {
        assert!((normalize_hybrid_score(0.03278688) - 1.0).abs() < 1e-5);
        assert_eq!(normalize_hybrid_score(0.0), 0.0);
        assert_eq!(normalize_hybrid_score(1.0), 1.0);
    }

    #[test]
    fn dedupe_keeps_best_chunk_and_orders() {
        // Vector 模式下 raw_score 是 COSINE 距离（越小越相似）。
        let scored = vec![
            ScoredHit::new(hit("a", 0.2, 10), SearchMode::Vector),
            ScoredHit::new(hit("b", 0.1, 20), SearchMode::Vector),
            ScoredHit::new(hit("a", 0.05, 10), SearchMode::Vector),
            ScoredHit::new(hit("c", 0.15, 30), SearchMode::Vector),
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
        assert_eq!(results[0].id, "p1");
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
