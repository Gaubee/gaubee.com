//! 伪相关反馈（PRF）：从首轮结果的标题/正文里提取扩展关键词。
//!
//! 只做一次额外检索：首轮 hybrid 取 topN，标题按 3 倍词频、正文按普通词频
//! 统计，用全库 IDF 压掉泛词后挑出不在原查询里的实词，拼成扩展查询再走
//! 同一套 hybrid；两轮结果按 RRF 合并。没有新模型、没有外部 API，失败时
//! 调用方回退首轮结果。
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::store::{fts_tokens, Hit};

/// 首轮反馈使用的 chunk 数。
pub const FEEDBACK_DEPTH: usize = 10;
/// 扩展轮 RRF 权重：原轮始终是 1.0，扩展轮不能压过用户原话。
pub const ROUND_WEIGHT: f32 = 0.8;
/// 默认扩展词数。
pub const DEFAULT_TERMS: usize = 4;
pub const MIN_TERMS: usize = 3;
pub const MAX_TERMS: usize = 5;
/// 反馈词的最大文档频率比例。超过它的词通常是标题模板/日期噪声（如「归档」）。
const MAX_DF_RATIO: f32 = 0.6;
/// 标题是人工提炼的主题词，按 3 倍计入词频，避免正文代码块淹没主题。
const TITLE_WEIGHT: usize = 3;
/// 过长的 token 多半是粘连的句子片段，不适合做查询词。
const MAX_TERM_CHARS: usize = 24;

/// 配置的扩展词数收敛到 3–5 个。
pub fn keyword_count(configured: usize) -> usize {
    configured.clamp(MIN_TERMS, MAX_TERMS)
}

#[derive(Debug, Default)]
struct TermStat {
    display: String,
    tf: u32,
    df: u32,
    first_doc: usize,
    score: f32,
}

/// 从首轮反馈里提取扩展关键词。
///
/// - 标题与正文都参与词频统计；
/// - 过滤停用词、单字、纯数字、过长 token，以及原查询已包含或与之重叠的词；
/// - 文档频率超过反馈集 60% 的词视为模板噪声；
/// - 用全库 chunk 级 IDF 给 TF 加权，压掉「时间/数据/提示」这类泛词；
/// - 按 TF×IDF 降序、TF 降序、DF 升序、首次出现顺序取前 N 个。
pub fn extract_keywords(
    feedback: &[Hit],
    query: &str,
    max_terms: usize,
    document_frequency: impl Fn(&str) -> u32,
    corpus_chunks: usize,
) -> Vec<String> {
    if feedback.is_empty() {
        return Vec::new();
    }
    let max_terms = keyword_count(max_terms);
    let query_lower = query.to_lowercase();
    let query_tokens = fts_tokens(query)
        .into_iter()
        .map(|token| token.to_lowercase())
        .collect::<Vec<_>>();

    let mut stats: HashMap<String, TermStat> = HashMap::new();
    for (doc_index, hit) in feedback.iter().enumerate() {
        let mut doc_terms = HashSet::new();
        let title_tokens = fts_tokens(&hit.title);
        let mut tokens = Vec::with_capacity(title_tokens.len() * TITLE_WEIGHT);
        for _ in 0..TITLE_WEIGHT {
            tokens.extend(title_tokens.iter().cloned());
        }
        tokens.extend(fts_tokens(&hit.text));
        for token in tokens {
            let lower = token.to_lowercase();
            if !is_usable_term(&token, &lower, &query_lower, &query_tokens) {
                continue;
            }
            let stat = stats.entry(lower.clone()).or_insert_with(|| TermStat {
                display: token,
                first_doc: doc_index,
                ..Default::default()
            });
            stat.tf += 1;
            if doc_terms.insert(lower) {
                stat.df += 1;
            }
        }
    }

    let feedback_count = feedback.len() as f32;
    let corpus_chunks = corpus_chunks.max(1) as f32;
    let mut candidates = stats
        .into_values()
        .filter(|stat| (stat.df as f32) < feedback_count * MAX_DF_RATIO)
        .map(|mut stat| {
            let df = document_frequency(&stat.display) as f32;
            // 平滑 IDF：全库常见的泛词接近 1，罕见词接近 ln(1+corpus)。
            stat.score = stat.tf as f32 * (1.0 + (corpus_chunks / (1.0 + df)).ln());
            stat
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.tf.cmp(&left.tf))
            .then_with(|| left.df.cmp(&right.df))
            .then_with(|| left.first_doc.cmp(&right.first_doc))
            .then_with(|| left.display.cmp(&right.display))
    });
    candidates
        .into_iter()
        .take(max_terms)
        .map(|stat| stat.display)
        .collect()
}

fn is_usable_term(token: &str, lower: &str, query_lower: &str, query_tokens: &[String]) -> bool {
    let chars = token.chars().count();
    if !(2..=MAX_TERM_CHARS).contains(&chars) {
        return false;
    }
    if token.chars().all(|character| character.is_ascii_digit()) {
        return false;
    }
    if !token.chars().any(char::is_alphabetic) {
        return false;
    }
    if is_stop_word(lower) || is_noise_token(lower) {
        return false;
    }
    // 原查询已覆盖：整词相同、查询包含该词、或该词包含查询里的实词。
    if query_lower.contains(lower) {
        return false;
    }
    if query_tokens
        .iter()
        .any(|query_token| query_token.chars().count() >= 2 && query_token.contains(lower))
    {
        return false;
    }
    true
}

fn is_noise_token(token: &str) -> bool {
    matches!(token, "http" | "https" | "www" | "md") || CODE_NOISE.contains(token)
}

/// 正文代码块高频的通用标识符：作为查询扩展词没有区分度。
static CODE_NOISE: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        "var",
        "let",
        "const",
        "return",
        "function",
        "args",
        "arg",
        "res",
        "req",
        "err",
        "error",
        "key",
        "value",
        "data",
        "arr",
        "array",
        "obj",
        "object",
        "str",
        "string",
        "num",
        "number",
        "index",
        "indexes",
        "length",
        "sub",
        "pub",
        "fn",
        "impl",
        "struct",
        "enum",
        "use",
        "mod",
        "crate",
        "super",
        "new",
        "type",
        "class",
        "interface",
        "export",
        "import",
        "default",
        "true",
        "false",
        "null",
        "none",
        "some",
        "ok",
        "map",
        "filter",
        "reduce",
        "promise",
        "then",
        "catch",
        "async",
        "await",
    ]
    .into_iter()
    .collect()
});

fn is_stop_word(token: &str) -> bool {
    STOP_WORDS.contains(token)
}

static STOP_WORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        // 结构助词、语气词
        "的",
        "了",
        "吗",
        "呢",
        "吧",
        "啊",
        "呀",
        "哦",
        "嗯",
        "着",
        "过",
        "地",
        "得", //
        // 代词
        "我",
        "你",
        "他",
        "她",
        "它",
        "我们",
        "你们",
        "他们",
        "咱们",
        "自己", //
        // 疑问词
        "怎么",
        "怎样",
        "怎么样",
        "如何",
        "为什么",
        "为何",
        "什么",
        "啥",
        "哪些",
        "哪个",
        "哪里",
        "多少",
        "是否",
        "能不能",
        "可不可以",
        "请问", //
        // 泛动词、情态与介词
        "需要",
        "一样",
        "可以",
        "一个",
        "想要",
        "让",
        "把",
        "用",
        "在",
        "想",
        "要",
        "能",
        "会",
        "就",
        "都",
        "也",
        "很",
        "太",
        "和",
        "与",
        "以及",
        "这",
        "那",
        "这个",
        "那个",
        "这些",
        "那些",
        "其",
        "之",
        "于",
        "对",
        "给",
        "为",
        "从",
        "到",
        "去",
        "来",
        "做",
        "搞",
        "弄",
        "干",
        "实现",
        "像",
        "不",
        "没",
        "没有",
        "有",
        "是",
        "被",
        "将",
        "还",
        "又",
        "再",
        "只",
        "才",
        "等",
        "个",
        "一下",
        "一段",
        "很多",
        "上",
        "下",
        "里",
        "中",
        "并且",
        "而且",
        "还有",
        "或者",
        "如果",
        "因为",
        "所以",
        "但是",
        "然后",
        "已经",
        "正在",
        "通过",
        "对于",
        "关于", //
        // 英文功能词与疑问词
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "if",
        "then",
        "than",
        "so",
        "to",
        "of",
        "in",
        "on",
        "at",
        "for",
        "with",
        "from",
        "by",
        "as",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "do",
        "does",
        "did",
        "can",
        "could",
        "should",
        "would",
        "will",
        "shall",
        "may",
        "might",
        "must",
        "i",
        "you",
        "he",
        "she",
        "it",
        "we",
        "they",
        "me",
        "him",
        "her",
        "us",
        "them",
        "my",
        "your",
        "his",
        "its",
        "our",
        "their",
        "this",
        "that",
        "these",
        "those",
        "what",
        "which",
        "who",
        "whom",
        "whose",
        "when",
        "where",
        "why",
        "how",
        "vs",
        "versus",
        "via",
        "using",
        "use",
        "used",
        "like",
        "want",
        "wants",
        "need",
        "needs",
        "not",
        "no",
        "into",
        "about",
        "over",
        "under",
        "between",
        "also",
    ]
    .into_iter()
    .collect()
});

#[cfg(test)]
mod tests {
    use super::*;

    fn feedback_hit(title: &str, text: &str, doc_id: i64, chunk_index: i32) -> Hit {
        Hit {
            doc_id,
            parent_id: format!("parent-{doc_id}"),
            app_id: "event".to_string(),
            title: title.to_string(),
            date: 0,
            chunk_index,
            href: format!("/article/events/{doc_id}"),
            text: text.to_string(),
            score: 0.0,
        }
    }

    #[test]
    fn extracts_keywords_and_filters_stopwords_query_and_noise() {
        let query = "像调用普通函数一样用多线程";
        let feedback = vec![
            feedback_hit(
                "Comlink-v2",
                "Comlink 多线程 worker 线程 通信 messageChannel messageChannel 2024",
                1,
                0,
            ),
            feedback_hit("Comlink-v2", "worker 通信 Proxy 线程", 1, 1),
            feedback_hit("X 归档 2024-01-01", "归档 归档 日报 函数 调用", 2, 0),
            feedback_hit("X 归档 2024-01-02", "归档 日报 模型 数据", 3, 0),
            feedback_hit("X 归档 2024-01-03", "归档 日报 模型 数据", 4, 0),
        ];
        let keywords = extract_keywords(&feedback, query, 4, |_| 1, 1_000);
        assert!(keywords.len() <= 4, "keywords={keywords:?}");
        assert!(
            keywords.iter().any(|keyword| keyword == "worker"),
            "keywords={keywords:?}"
        );
        assert!(
            keywords.iter().any(|keyword| keyword == "messageChannel"),
            "keywords={keywords:?}"
        );
        for banned in ["多线程", "线程", "函数", "调用", "归档", "日报", "2024"] {
            assert!(
                !keywords.iter().any(|keyword| keyword == banned),
                "banned={banned} keywords={keywords:?}"
            );
        }
    }

    #[test]
    fn keyword_count_is_clamped_to_three_through_five() {
        assert_eq!(keyword_count(0), MIN_TERMS);
        assert_eq!(keyword_count(2), MIN_TERMS);
        assert_eq!(keyword_count(4), 4);
        assert_eq!(keyword_count(99), MAX_TERMS);
    }

    #[test]
    fn empty_feedback_or_query_only_terms_return_nothing() {
        assert!(extract_keywords(&[], "rust", 4, |_| 1, 1_000).is_empty());
        let feedback = vec![feedback_hit("Rust 异步", "Rust 异步 运行时", 1, 0)];
        assert!(extract_keywords(&feedback, "Rust 异步 运行时", 4, |_| 1, 1_000).is_empty());
    }

    #[test]
    fn template_noise_is_dropped_by_document_frequency() {
        let query = "无关查询词";
        let feedback = (0..10)
            .map(|index| {
                let text = if index < 3 {
                    "归档 日报 vector"
                } else {
                    "归档 日报 公共词"
                };
                feedback_hit(&format!("X 归档 2024-01-{index:02}"), text, index, 0)
            })
            .collect::<Vec<_>>();
        let keywords = extract_keywords(&feedback, query, 4, |_| 1, 1_000);
        assert!(!keywords.iter().any(|keyword| keyword == "归档"));
        assert!(!keywords.iter().any(|keyword| keyword == "日报"));
        assert!(keywords.iter().any(|keyword| keyword == "vector"));
    }

    #[test]
    fn ranking_is_deterministic_by_tf_then_df() {
        let feedback = vec![
            feedback_hit("doc-a", "alpha beta beta beta", 1, 0),
            feedback_hit("doc-b", "alpha gamma gamma", 2, 0),
            feedback_hit("doc-c", "delta epsilon", 3, 0),
            feedback_hit("doc-d", "zeta", 4, 0),
        ];
        let keywords = extract_keywords(&feedback, "完全无关", 3, |_| 1, 1_000);
        // beta tf=3 排第一；alpha/gamma tf 并列（2），df 更低的 gamma 优先。
        assert_eq!(keywords[0], "beta");
        assert_eq!(keywords[1], "gamma");
        assert_eq!(keywords[2], "alpha");
    }

    #[test]
    fn corpus_idf_suppresses_generic_terms() {
        let feedback = vec![
            feedback_hit(
                "doc-a",
                "时间 时间 时间 messageChannel messageChannel Proxy worker",
                1,
                0,
            ),
            feedback_hit("doc-b", "delta epsilon", 2, 0),
            feedback_hit("doc-c", "zeta eta", 3, 0),
            feedback_hit("doc-d", "theta", 4, 0),
        ];
        let keywords = extract_keywords(
            &feedback,
            "完全无关",
            3,
            |token| match token {
                "时间" => 500,
                "messageChannel" => 2,
                "Proxy" => 2,
                _ => 1,
            },
            1_000,
        );
        assert_eq!(keywords[0], "messageChannel");
        assert!(
            !keywords.iter().any(|keyword| keyword == "时间"),
            "keywords={keywords:?}"
        );
    }
}
