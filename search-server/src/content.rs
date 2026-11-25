//! 读取 `src/content/{events,articles}/*.md`，解析 frontmatter 并清洗成可索引正文。
//!
//! 只索引公开内容目录；文档身份（parentId / href）与站点既有搜索索引保持一致：
//! - parentId = `src/content/{collection}/{filename}`
//! - href = `/article/{collection}/{stem}`（stem 为去掉 `.md` 的文件名）
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use regex::Regex;
use serde_yaml::Value;
use walkdir::WalkDir;

pub const APP_EVENT: &str = "event";
pub const APP_ARTICLES: &str = "articles";

/// 内容集合：目录名与搜索应用名不同（events 目录对应 event 应用）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Collection {
    Articles,
    Events,
}

impl Collection {
    pub fn directory(self) -> &'static str {
        match self {
            Collection::Articles => "articles",
            Collection::Events => "events",
        }
    }

    pub fn app_id(self) -> &'static str {
        match self {
            Collection::Articles => APP_ARTICLES,
            Collection::Events => APP_EVENT,
        }
    }
}

/// 单篇内容的清洗结果（chunk 之前）。
#[derive(Debug, Clone)]
pub struct SourceDocument {
    pub parent_id: String,
    pub app_id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub date: i64,
    pub href: String,
    pub text: String,
}

static FRONTMATTER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)^\u{feff}?---\r?\n(.*?)\r?\n---\r?\n?").expect("frontmatter 正则")
});
static SCRIPT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<script\b[^>]*>.*?</script\s*>").expect("script 正则"));
static STYLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<style\b[^>]*>.*?</style\s*>").expect("style 正则"));
static NOSCRIPT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<noscript\b[^>]*>.*?</noscript\s*>").expect("noscript 正则")
});
static TEMPLATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<template\b[^>]*>.*?</template\s*>").expect("template 正则")
});
static COMMENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").expect("注释正则"));
static IMAGE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!\[[^\]]*\]\([^)]*\)").expect("图片正则"));
static LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").expect("链接正则"));
static REF_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s{0,3}\[[^\]]+\]:\s*\S+.*$").expect("引用链接正则"));
static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"https?://\S+").expect("URL 正则"));
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("HTML 标签正则"));
static FENCE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*```.*$").expect("代码围栏正则"));
static HEADING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s{0,3}#{1,6}\s+").expect("标题正则"));
static LIST_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s{0,3}(?:[-*+]|\d+\.)\s+").expect("列表正则"));
static EMPHASIS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[*_~`>#]+").expect("强调符号正则"));
static SPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("空白正则"));

/// 扫描内容根目录下两个集合的 markdown 文件。
pub fn load_content(content_root: &Path) -> Result<Vec<SourceDocument>> {
    let mut documents = Vec::new();
    for collection in [Collection::Articles, Collection::Events] {
        let directory = content_root.join(collection.directory());
        if !directory.is_dir() {
            continue;
        }
        let mut files: Vec<PathBuf> = WalkDir::new(&directory)
            .max_depth(1)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("md"))
            .collect();
        files.sort();

        for path in files {
            match parse_document(&path, collection) {
                Ok(Some(document)) => documents.push(document),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "跳过无法解析的内容文件");
                }
            }
        }
    }
    Ok(documents)
}

/// 解析单个 markdown 文件；正文为空时返回 None。
pub fn parse_document(path: &Path, collection: Collection) -> Result<Option<SourceDocument>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("读取内容文件失败：{}", path.display()))?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("内容文件名不是合法 UTF-8")?
        .to_string();
    let stem = filename
        .strip_suffix(".md")
        .unwrap_or(&filename)
        .to_string();

    let (metadata, body) = split_frontmatter(&raw);
    let title = metadata
        .as_ref()
        .and_then(|value| value.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| slug_from_stem(&stem));

    let tags = metadata
        .as_ref()
        .and_then(|value| value.get("tags"))
        .and_then(Value::as_sequence)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let date = metadata
        .as_ref()
        .and_then(|value| value.get("date"))
        .map(parse_date_value)
        .unwrap_or(0);

    // 正文只有链接/图片等被清洗掉时，退回标题，避免整篇内容不可检索。
    let mut text = clean_markdown(body);
    if text.is_empty() {
        text = title.clone();
    }
    if text.is_empty() {
        return Ok(None);
    }

    Ok(Some(SourceDocument {
        parent_id: format!("src/content/{}/{}", collection.directory(), filename),
        app_id: collection.app_id().to_string(),
        title,
        tags,
        date,
        href: format!("/article/{}/{}", collection.directory(), stem),
        text,
    }))
}

/// 拆出 YAML frontmatter 与正文；frontmatter 解析失败时按无元数据处理。
pub fn split_frontmatter(raw: &str) -> (Option<Value>, &str) {
    let Some(captures) = FRONTMATTER_RE.captures(raw) else {
        return (None, raw);
    };
    let whole = captures.get(0).expect("整段匹配存在");
    let yaml = captures.get(1).map(|m| m.as_str()).unwrap_or("");
    let metadata = serde_yaml::from_str::<Value>(yaml).ok();
    (metadata, &raw[whole.end()..])
}

fn parse_date_value(value: &Value) -> i64 {
    match value {
        Value::String(text) => parse_date_str(text).unwrap_or(0),
        Value::Number(number) => number.as_i64().unwrap_or(0),
        _ => 0,
    }
}

fn parse_date_str(text: &str) -> Option<i64> {
    let text = text.trim();
    if let Ok(date) = DateTime::parse_from_rfc3339(text) {
        return Some(date.with_timezone(&Utc).timestamp_millis());
    }
    if let Ok(date) = NaiveDate::parse_from_str(&text[..text.len().min(10)], "%Y-%m-%d") {
        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    if let Ok(date) = text.parse::<DateTime<Utc>>() {
        return Some(date.timestamp_millis());
    }
    None
}

/// 文件名去掉 `NNNNN.` 序号前缀后作为标题兜底。
fn slug_from_stem(stem: &str) -> String {
    match stem.split_once('.') {
        Some((prefix, rest))
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) =>
        {
            rest.replace(['-', '_'], " ")
        }
        _ => stem.replace(['-', '_'], " "),
    }
}

/// 去除 HTML/脚本/图片/链接/装饰符号，保留可检索正文。
pub fn clean_markdown(markdown: &str) -> String {
    let mut text = SCRIPT_RE.replace_all(markdown, " ").into_owned();
    text = STYLE_RE.replace_all(&text, " ").into_owned();
    text = NOSCRIPT_RE.replace_all(&text, " ").into_owned();
    text = TEMPLATE_RE.replace_all(&text, " ").into_owned();
    text = COMMENT_RE.replace_all(&text, " ").into_owned();
    text = FENCE_RE.replace_all(&text, " ").into_owned();
    text = IMAGE_RE.replace_all(&text, " ").into_owned();
    text = LINK_RE.replace_all(&text, "$1").into_owned();
    text = REF_LINK_RE.replace_all(&text, " ").into_owned();
    text = TAG_RE.replace_all(&text, " ").into_owned();
    text = URL_RE.replace_all(&text, " ").into_owned();
    text = HEADING_RE.replace_all(&text, "").into_owned();
    text = LIST_RE.replace_all(&text, "").into_owned();
    text = EMPHASIS_RE.replace_all(&text, "").into_owned();

    for (from, to) in [
        ("&nbsp;", " "),
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&#x27;", "'"),
    ] {
        text = text.replace(from, to);
    }

    SPACE_RE.replace_all(&text, " ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_title_tags_date_and_body() {
        let raw = "---\ntitle: 测试标题\ndate: 2024-03-01T02:03:04.000Z\ntags:\n  - rust\n  - ai\n---\n\n正文 **内容**。\n";
        let (metadata, body) = split_frontmatter(raw);
        let metadata = metadata.expect("frontmatter 可解析");
        assert_eq!(
            metadata.get("title").and_then(Value::as_str),
            Some("测试标题")
        );
        assert_eq!(parse_date_value(&metadata["date"]), 1_709_258_584_000);
        assert!(body.contains("正文"));
        assert_eq!(clean_markdown(body), "正文 内容。");
    }

    #[test]
    fn strips_html_scripts_images_and_urls() {
        let raw = r#"<script>alert(1)</script><img src="x.png" alt="图">
![截图](https://example.com/a.png) 可见文字 <https://example.com/x> [链接](https://example.com)
```
code fence
```
"#;
        let cleaned = clean_markdown(raw);
        assert!(!cleaned.contains("alert"));
        assert!(!cleaned.contains("example.com"));
        assert!(!cleaned.contains("截图"));
        assert!(cleaned.contains("可见文字"));
        assert!(cleaned.contains("链接"));
        assert!(cleaned.contains("code fence"));
    }

    #[test]
    fn slug_falls_back_when_no_title() {
        assert_eq!(slug_from_stem("00001.first-event"), "first event");
        assert_eq!(slug_from_stem("plain-name"), "plain name");
    }

    #[test]
    fn parses_date_only_fallback() {
        assert_eq!(parse_date_str("2020-01-02"), Some(1_577_923_200_000));
        assert_eq!(parse_date_str("not a date"), None);
    }
}

#[cfg(test)]
mod title_fallback_tests {
    use super::*;

    #[test]
    fn body_with_only_link_falls_back_to_title() {
        let directory = tempfile::tempdir().expect("临时目录");
        let path = directory.path().join("0001.go-wasm.md");
        std::fs::write(
            &path,
            "---\ntitle: 初识 go-wasm\ndate: 2021-04-22T12:53:00.000Z\n---\n\nhttps://example.com/repo\n",
        )
        .expect("写入 fixture");
        let document = parse_document(&path, Collection::Articles)
            .expect("解析")
            .expect("标题回退后仍应产生文档");
        assert_eq!(document.title, "初识 go-wasm");
        assert_eq!(document.text, "初识 go-wasm");
        assert_eq!(document.href, "/article/articles/0001.go-wasm");
    }
}
