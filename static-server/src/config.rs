//! cdn-base 配置（cdn-media plan A9 schema 冻结）：
//! TOML 解析 + env 覆盖 + 校验。文件缺失/字段非法 → 启动即败，
//! 日志给出修复指令（scratch 无 shell，错误信息必须自解释）。
//!
//! env 覆盖优先级高于配置文件：CDN_CONFIG（文件路径）、MEDIA_CACHE_DIR、
//! ADMIN_PORT、CDN_GITHUB_TOKEN、CDN_ADMIN_TOKEN。

use std::path::PathBuf;

use serde::Deserialize;

/// 环境变量载体：进程 env 的薄包装，测试可注入（避免测试间 env 竞态）。
pub trait EnvSource {
    fn get(&self, key: &str) -> Option<String>;
}

pub struct ProcessEnv;

impl EnvSource for ProcessEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok().filter(|v| !v.is_empty())
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub version: u32,
    pub manifest: ManifestCfg,
    pub github: GithubCfg,
    pub sources: SourcesCfg,
    #[serde(default)]
    pub cache: CacheCfg,
    #[serde(default)]
    pub pinned: PinnedCfg,
    #[serde(default)]
    pub admin: AdminCfg,
    #[serde(default)]
    pub media: MediaCfg,
    /// Phase 2 预留（A9 冻结字段；Phase 1 只解析不消费）
    #[serde(default)]
    #[allow(dead_code)]
    pub geo: GeoCfg,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ManifestCfg {
    /// 指针文件：raw 主分支 current.json（无 API 限额）
    pub current_url: String,
    /// 短 TTL（秒）：TTL 内沿用内存 last-known-good，不发起条件请求
    #[serde(default = "default_refresh_interval")]
    pub refresh_interval_secs: u64,
}

fn default_refresh_interval() -> u64 {
    300
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct GithubCfg {
    /// 媒体仓库（owner/name）：卷 asset 的 API URL 由 asset id + 本仓库构造（A2）
    pub repo: String,
    /// 可选只读 token；公开仓库留空。真实 token 只经 env CDN_GITHUB_TOKEN 注入
    #[serde(default)]
    pub token: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SourcesCfg {
    /// source 白名单（/cdn-media/<source>/ 只接受列内值）
    pub allow: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct CacheCfg {
    /// 缓存目录（A3 bind mount：宿主预创建并 chown 65532:65532）
    #[serde(default = "default_cache_dir")]
    pub dir: String,
    /// LRU 高水位（字节）：超 high 逐出到 low
    #[serde(default = "default_high")]
    pub high_bytes: u64,
    /// LRU 低水位（字节）
    #[serde(default = "default_low")]
    pub low_bytes: u64,
    /// 超过该大小的对象透传不落盘（pinned 例外常驻）
    #[serde(default = "default_large_object")]
    pub large_object_bytes: u64,
    /// 完整性严格模式（R3；r5 P1-7）：true = 回源先缓冲全量（≤max_buffer_bytes）
    /// 校验 sha256 通过后才响应（immutable 可承诺）；false（默认）= 流式 tee
    /// （响应头 no-store——校验通过前不承诺 immutable，失败拒缓存）
    #[serde(default)]
    pub strict_integrity: bool,
    /// 严格模式缓冲上限（字节，默认 128MB）：超过该大小的对象严格模式下
    /// 退化为透传（no-store），绝不无界缓冲
    #[serde(default = "default_max_buffer")]
    pub max_buffer_bytes: u64,
}

impl Default for CacheCfg {
    fn default() -> Self {
        Self {
            dir: default_cache_dir(),
            high_bytes: default_high(),
            low_bytes: default_low(),
            large_object_bytes: default_large_object(),
            strict_integrity: false,
            max_buffer_bytes: default_max_buffer(),
        }
    }
}

fn default_cache_dir() -> String {
    "/media-cache".into()
}
fn default_high() -> u64 {
    524_288_000
}
fn default_low() -> u64 {
    314_572_800
}
fn default_large_object() -> u64 {
    52_428_800
}
fn default_max_buffer() -> u64 {
    134_217_728
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct PinnedCfg {
    /// 常驻 key（canonical media key，计入总容量；合计超 high_bytes 启动失败）
    #[serde(default)]
    pub keys: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct AdminCfg {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 容器内监听端口（compose 只发布宿主 127.0.0.1:8081）
    #[serde(default = "default_admin_port")]
    pub port: u16,
    /// 可选 Bearer token（真实 token 只经 env CDN_ADMIN_TOKEN 注入）
    #[serde(default)]
    pub token: String,
}

impl Default for AdminCfg {
    fn default() -> Self {
        Self {
            enabled: true,
            port: 8081,
            token: String::new(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_admin_port() -> u16 {
    8081
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct MediaCfg {
    /// 默认 mediaBase（A8：默认同源；Phase 2 前不消费——本字段仅解析不读，
    /// Phase 2 geo 回退时才启用）
    #[serde(default = "default_media_base")]
    pub base: String,
}

impl Default for MediaCfg {
    fn default() -> Self {
        Self {
            base: "/cdn-media".into(),
        }
    }
}

fn default_media_base() -> String {
    "/cdn-media".into()
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct GeoCfg {
    /// Phase 2 预留：地区规则与 KV namespace（Phase 1 不读）
    #[serde(default)]
    #[allow(dead_code)]
    pub rules: Vec<serde_json::Value>,
    #[serde(default)]
    #[allow(dead_code)]
    pub kv_namespace: String,
}

/// 配置文件发现顺序：env CDN_CONFIG → ./config.toml → /config.toml
pub fn resolve_config_path(env: &dyn EnvSource) -> Option<PathBuf> {
    if let Some(p) = env.get("CDN_CONFIG") {
        return Some(PathBuf::from(p));
    }
    for p in ["config.toml", "/config.toml"] {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    None
}

/// 加载 + env 覆盖 + 纯字段校验（不触盘/不触网的部分）。
/// 失败返回带修复指令的错误文本（调用方打印后 exit(1)）。
pub fn load(env: &dyn EnvSource) -> Result<Config, String> {
    let path = resolve_config_path(env).ok_or_else(|| {
        "未找到 cdn-base 配置文件（A9：文件缺失启动即败）。修复：\
         cp static-server/config.example.toml config.toml 并按环境修改；\
         或用 env CDN_CONFIG=/绝对路径/config.toml 指定"
            .to_owned()
    })?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取配置 {path:?} 失败：{e}（修复：检查文件存在与可读权限）"))?;
    let mut cfg: Config = toml::from_str(&raw)
        .map_err(|e| format!("解析配置 {path:?} 失败：{e}（修复：对照 config.example.toml 检查字段名与类型）"))?;
    apply_env_overrides(&mut cfg, env)?;
    cfg.validate()?;
    Ok(cfg)
}

impl Config {
    /// 纯字段校验（磁盘/网络相关的启动强校验在 main 中做，需要 fs 与 manifest）
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!(
                "config.version = {} 不受支持（修复：本程序仅支持 version = 1）",
                self.version
            ));
        }
        if !self.manifest.current_url.starts_with("https://") && !is_loopback_url(&self.manifest.current_url) {
            return Err(format!(
                "manifest.current_url 必须是 https:// 开头（当前：{}）；仅 loopback 允许 http",
                self.manifest.current_url
            ));
        }
        let repo_parts: Vec<&str> = self.github.repo.split('/').collect();
        if repo_parts.len() != 2
            || repo_parts.iter().any(|p| p.is_empty())
            || !self.github.repo.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/'))
        {
            return Err(format!(
                "github.repo 必须形如 owner/name（当前：{}）",
                self.github.repo
            ));
        }
        if self.sources.allow.is_empty() {
            return Err("sources.allow 不能为空（修复：至少列出一个 source，如 [\"x\"]）".to_owned());
        }
        for s in &self.sources.allow {
            if s.is_empty()
                || !s
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_'))
            {
                return Err(format!(
                    "sources.allow 含非法 source：{s:?}（修复：仅允许小写字母/数字/-/_）"
                ));
            }
        }
        if self.cache.low_bytes >= self.cache.high_bytes {
            return Err(format!(
                "cache.low_bytes({}) 必须小于 cache.high_bytes({})（修复：调低 low 或调高 high）",
                self.cache.low_bytes, self.cache.high_bytes
            ));
        }
        if self.cache.high_bytes == 0 {
            return Err("cache.high_bytes 不能为 0".to_owned());
        }
        // r5 P1-14：非法值一律启动失败（不静默回退）
        if self.manifest.refresh_interval_secs == 0 {
            return Err("manifest.refresh_interval_secs = 0 非法（修复：≥1 秒，建议 300）".to_owned());
        }
        if self.admin.port == 0 {
            return Err("admin.port = 0 非法（修复：改为有效监听端口，如 8081）".to_owned());
        }
        if self.cache.dir.is_empty() {
            return Err("cache.dir 为空（修复：配置绝对路径，如 /media-cache）".to_owned());
        }
        if !PathBuf::from(&self.cache.dir).is_absolute() {
            return Err(format!(
                "cache.dir 必须是绝对路径（当前：{:?}；修复：如 /media-cache）",
                self.cache.dir
            ));
        }
        // r6 P1-1：严格模式缓冲上限冻结为 1..=134217728（128MiB）——超过上界一律
        // 启动即败，杜绝部署者把严格模式意外配成无界级别的资源消耗
        if self.cache.max_buffer_bytes == 0 || self.cache.max_buffer_bytes > 134_217_728 {
            return Err(format!(
                "cache.max_buffer_bytes 必须在 1..=134217728（128MiB）内（当前：{}；修复：如 134217728 即 128MB）",
                self.cache.max_buffer_bytes
            ));
        }
        for k in &self.pinned.keys {
            if let Err(e) = validate_key(k) {
                return Err(format!("pinned.keys 含非法 key {k:?}：{e}"));
            }
            let source = k.split('/').next().unwrap_or("");
            if !self.sources.allow.iter().any(|s| s == source) {
                return Err(format!(
                    "pinned.keys 的 source {source:?} 不在 sources.allow 内（key：{k}）"
                ));
            }
        }
        if !self.media.base.starts_with('/') {
            return Err(format!(
                "media.base 必须以 / 开头（当前：{}）",
                self.media.base
            ));
        }
        Ok(())
    }
}

fn is_loopback_url(url: &str) -> bool {
    // 本地私有化同拓扑：仅 loopback 主机允许 http
    url.starts_with("http://localhost/")
        || url.starts_with("http://localhost:")
        || url.starts_with("http://127.0.0.1/")
        || url.starts_with("http://127.0.0.1:")
        || url.starts_with("http://[::1]/")
        || url.starts_with("http://[::1]:")
}

/// env 覆盖：解析失败一律返回 Err（启动即败），绝不静默忽略（r5 P1-14）
fn apply_env_overrides(cfg: &mut Config, env: &dyn EnvSource) -> Result<(), String> {
    if let Some(v) = env.get("MEDIA_CACHE_DIR") {
        cfg.cache.dir = v;
    }
    if let Some(v) = env.get("ADMIN_PORT") {
        let p: u16 = v
            .parse()
            .map_err(|_| format!("ADMIN_PORT={v:?} 解析失败（修复：必须是 1-65535 的整数）"))?;
        if p == 0 {
            return Err("ADMIN_PORT=0 非法（修复：改为有效监听端口）".to_owned());
        }
        cfg.admin.port = p;
    }
    if let Some(v) = env.get("CDN_GITHUB_TOKEN") {
        cfg.github.token = v;
    }
    if let Some(v) = env.get("CDN_ADMIN_TOKEN") {
        cfg.admin.token = v;
    }
    Ok(())
}

/// 媒体 key 校验（唯一入口，pinned 与请求路径共用）：
/// 字符白名单 + 禁 `..`/`.` 段与空段。对 raw 路径生效（含 `%` 一律拒绝，
/// 从根上消除百分号编码的二义性；manifest 键集实测均在白名单内）。
pub fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("key 为空".to_owned());
    }
    if key.starts_with('/') || key.ends_with('/') {
        return Err("key 不能以 / 开头或结尾".to_owned());
    }
    if key.contains('\\') {
        return Err("key 含反斜杠".to_owned());
    }
    for seg in key.split('/') {
        if seg.is_empty() {
            return Err("key 含空路径段".to_owned());
        }
        if seg == "." || seg == ".." {
            return Err(format!("key 含相对路径段 {seg:?}"));
        }
        if !seg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err("key 含白名单外字符（仅允许 A-Za-z0-9._-）".to_owned());
        }
    }
    Ok(())
}

/// 测试/本地注入用的静态 env 表（仅测试构建）
#[cfg(test)]
pub struct MapEnv(pub std::collections::HashMap<String, String>);

#[cfg(test)]
impl EnvSource for MapEnv {
    fn get(&self, key: &str) -> Option<String> {
        self.0.get(key).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const EXAMPLE: &str = include_str!("../config.example.toml");

    #[test]
    fn example_config_parses_and_validates() {
        let mut cfg: Config = toml::from_str(EXAMPLE).expect("example 配置必须可解析");
        apply_env_overrides(&mut cfg, &MapEnv(HashMap::new())).expect("env 覆盖应成功");
        cfg.validate().expect("example 配置必须通过校验");
        assert_eq!(cfg.version, 1);
        assert_eq!(cfg.cache.high_bytes, 524_288_000);
        assert_eq!(cfg.cache.low_bytes, 314_572_800);
        assert_eq!(cfg.sources.allow, vec!["x".to_owned()]);
        assert_eq!(cfg.admin.port, 8081);
        // r5 P1-7：严格模式默认关闭、缓冲上限默认 128MB
        assert!(!cfg.cache.strict_integrity, "strict_integrity 默认必须为 false");
        assert_eq!(cfg.cache.max_buffer_bytes, 134_217_728);
    }

    #[test]
    fn env_overrides_apply() {
        let mut env = HashMap::new();
        env.insert("MEDIA_CACHE_DIR".to_owned(), "/tmp/x-cache".to_owned());
        env.insert("ADMIN_PORT".to_owned(), "9099".to_owned());
        env.insert("CDN_ADMIN_TOKEN".to_owned(), "sekrit".to_owned());
        let mut cfg: Config = toml::from_str(EXAMPLE).unwrap();
        apply_env_overrides(&mut cfg, &MapEnv(env)).expect("env 覆盖应成功");
        assert_eq!(cfg.cache.dir, "/tmp/x-cache");
        assert_eq!(cfg.admin.port, 9099);
        assert_eq!(cfg.admin.token, "sekrit");
    }

    /// r5 P1-14：env 解析失败必须 die，绝不静默忽略
    #[test]
    fn env_admin_port_parse_failure_dies() {
        let mut cfg: Config = toml::from_str(EXAMPLE).unwrap();
        let mut env = HashMap::new();
        env.insert("ADMIN_PORT".to_owned(), "not-a-port".to_owned());
        let err = apply_env_overrides(&mut cfg, &MapEnv(env)).expect_err("解析失败必须报错");
        assert!(err.contains("ADMIN_PORT"), "错误信息必须指认字段：{err}");
        let mut env = HashMap::new();
        env.insert("ADMIN_PORT".to_owned(), "0".to_owned());
        let err = apply_env_overrides(&mut cfg, &MapEnv(env)).expect_err("port=0 必须报错");
        assert!(err.contains("ADMIN_PORT"));
    }

    /// r5 P1-14：非法值矩阵全部启动失败
    #[test]
    fn rejects_invalid_values() {
        let cases: Vec<(&str, String)> = vec![
            ("refresh_interval_secs=0", EXAMPLE.replacen("refresh_interval_secs = 300", "refresh_interval_secs = 0", 1)),
            ("admin.port=0", EXAMPLE.replacen("port = 8081", "port = 0", 1)),
            ("cache.dir empty", EXAMPLE.replacen("dir = \"/media-cache\"", "dir = \"\"", 1)),
            ("cache.dir relative", EXAMPLE.replacen("dir = \"/media-cache\"", "dir = \"media-cache\"", 1)),
            ("max_buffer_bytes=0", EXAMPLE.replacen("max_buffer_bytes = 134217728   # 128MB", "max_buffer_bytes = 0", 1)),
        ];
        for (what, raw) in cases {
            let cfg: Config = toml::from_str(&raw).expect("解析应成功（校验层拒绝）");
            assert!(cfg.validate().is_err(), "{what} 必须被校验拒绝");
        }
    }

    /// r6 P1-1：strict buffer 上界冻结 128MiB——超上界拒绝、边界值放行
    #[test]
    fn max_buffer_bytes_frozen_upper_bound() {
        // 恰好超 1 字节 → 拒绝
        let raw = EXAMPLE.replacen(
            "max_buffer_bytes = 134217728   # 128MB",
            "max_buffer_bytes = 134217729",
            1,
        );
        let cfg: Config = toml::from_str(&raw).expect("解析应成功（校验层拒绝）");
        let err = cfg.validate().expect_err("超 128MiB 必须被拒");
        assert!(err.contains("134217728"), "错误信息必须给出上界：{err}");
        // 极端值（i64::MAX，TOML 整数上界）→ 校验层拒绝
        let raw = EXAMPLE.replacen(
            "max_buffer_bytes = 134217728   # 128MB",
            "max_buffer_bytes = 9223372036854775807",
            1,
        );
        let cfg: Config = toml::from_str(&raw).unwrap();
        assert!(cfg.validate().is_err(), "超 128MiB 的极端值必须被拒");
        // u64::MAX 在 TOML 整数（i64）域外 → 解析层即拒绝（同样启动即败）
        let raw = EXAMPLE.replacen(
            "max_buffer_bytes = 134217728   # 128MB",
            "max_buffer_bytes = 18446744073709551615",
            1,
        );
        assert!(toml::from_str::<Config>(&raw).is_err(), "u64::MAX 必须被解析层拒绝");
        // 恰好上界 → 放行
        let raw = EXAMPLE.replacen(
            "max_buffer_bytes = 134217728   # 128MB",
            "max_buffer_bytes = 134217728",
            1,
        );
        let cfg: Config = toml::from_str(&raw).unwrap();
        cfg.validate().expect("恰好 128MiB 必须放行");
        // 恰好下界 1 → 放行
        let raw = EXAMPLE.replacen(
            "max_buffer_bytes = 134217728   # 128MB",
            "max_buffer_bytes = 1",
            1,
        );
        let cfg: Config = toml::from_str(&raw).unwrap();
        cfg.validate().expect("1 字节必须放行");
    }

    #[test]
    fn rejects_low_ge_high() {
        let raw = EXAMPLE.replacen("low_bytes = 314572800", "low_bytes = 524288000", 1);
        let cfg: Result<Config, _> = toml::from_str(&raw);
        let cfg = cfg.expect("解析应成功");
        assert!(cfg.validate().is_err(), "low >= high 必须被拒");
    }

    #[test]
    fn rejects_unknown_field() {
        let raw = EXAMPLE.replacen("version = 1", "version = 1\ntypo_field = 2", 1);
        assert!(toml::from_str::<Config>(&raw).is_err(), "未知字段必须被拒");
    }

    #[test]
    fn rejects_bad_version() {
        let raw = EXAMPLE.replacen("version = 1", "version = 2", 1);
        let cfg: Config = toml::from_str(&raw).unwrap();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn rejects_pinned_source_not_in_allowlist() {
        let raw = EXAMPLE.replacen("keys = []", "keys = [\"misc/a.jpg\"]", 1);
        let cfg: Config = toml::from_str(&raw).unwrap();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn key_validation_matrix() {
        assert!(validate_key("x/1970-01/a.jpg").is_ok());
        assert!(validate_key("x/1970-01/a-b_c.JPG").is_ok());
        assert!(validate_key("").is_err());
        assert!(validate_key("/x/a.jpg").is_err());
        assert!(validate_key("x/a.jpg/").is_err());
        assert!(validate_key("x/../etc").is_err());
        assert!(validate_key("x/./a.jpg").is_err());
        assert!(validate_key("x//a.jpg").is_err());
        assert!(validate_key("x/a\\b.jpg").is_err());
        assert!(validate_key("x/a%2F..%2Fb.jpg").is_err());
        assert!(validate_key("x/空格 a.jpg").is_err());
    }
}
