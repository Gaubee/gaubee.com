//! GitHub 源适配器（A2 git 指针协议解析）：
//!
//! raw 主分支 `current.json`（短 TTL + ETag 条件请求）→ sha256 校验 →
//! `manifest-<gen>.json`（按约定永不重写，长缓存：gen 未变则不重拉）→
//! 解析 + 校验通过才原子替换内存索引；失败/超时保留 last-known-good。
//! 冷启动无 LKG 时 source 视为不可用（由 handler 返回 503，服务照常起）。
//!
//! 重试参数（2026-10-06 演练实测定死）：重试 4 次，退避 3/6/12/24s——
//! raw 偶发非 200，不重试演练必挂。404 不重试（指针缺失是确定性问题）。
//!
//! 卷 URL 一律用 asset id 的 API URL（`/repos/<repo>/releases/assets/<id>`，
//! Accept: application/octet-stream 跟随重定向），不按 tag+文件名拼（A2：
//! 防 tag/asset 误改毁长缓存；current.json 里的下载 URL 字段刻意不使用）。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

use crate::config::Config;

/// 指针/清单拉取重试：首拉 + 4 次重试，退避秒数（演练实测）
pub const RETRY_DELAYS_SECS: [u64; 4] = [3, 6, 12, 24];

/// manifest 单对象索引（卷内定位 + 完整性 + 响应头素材）
#[derive(Clone, Debug)]
pub struct MediaObject {
    pub volume: String,
    pub offset: u64,
    pub size: u64,
    pub sha256: String,
    pub content_type: String,
}

/// 解析并校验通过后的内存索引（不可变，整体原子替换）
#[derive(Debug)]
pub struct ManifestIndex {
    pub gen: u64,
    /// canonical media key → 对象条目
    pub objects: HashMap<String, MediaObject>,
    /// 卷名 → release asset id（构造 API URL）
    pub volume_assets: HashMap<String, u64>,
    pub loaded_at: SystemTime,
    /// 指针指纹（r5 P0-5）：manifest_sha256 + manifest_path + 各卷 (name, asset_id,
    /// sha256) 的 hash——同 gen 但指纹变化 = 指针内容变化 → 必须重新校验清单
    pub pointer_fingerprint: String,
    /// 对象回源 URL 前缀（生产 = https://api.github.com；测试注入 localhost mock）
    url_base: String,
}

impl ManifestIndex {
    pub fn lookup(&self, key: &str) -> Option<&MediaObject> {
        self.objects.get(key)
    }

    /// 对象的回源 URL：asset id API URL（A2 契约，见模块头注）
    pub fn object_url(&self, repo: &str, obj: &MediaObject) -> Option<String> {
        let asset_id = self.volume_assets.get(&obj.volume)?;
        Some(format!(
            "{base}/repos/{repo}/releases/assets/{asset_id}",
            base = self.url_base
        ))
    }

    /// 测试专用构造：media.rs 的 mock 上游测试注入 localhost url_base
    #[cfg(test)]
    pub(crate) fn new_for_test(
        gen: u64,
        volume_assets: HashMap<String, u64>,
        url_base: String,
    ) -> Self {
        Self {
            gen,
            objects: HashMap::new(),
            volume_assets,
            loaded_at: SystemTime::now(),
            pointer_fingerprint: "test-fingerprint".to_owned(),
            url_base,
        }
    }
}

// ---- wire 格式（与 cdn-media 子仓 manifest 产物逐字段对齐） ----

#[derive(Deserialize, Debug)]
struct CurrentJson {
    gen: u64,
    manifest_sha256: String,
    manifest_path: String,
    volumes: Vec<CurrentVolumeJson>,
}

#[derive(Deserialize, Debug)]
struct CurrentVolumeJson {
    asset_id: u64,
    /// 刻意不使用：按 tag+文件名拼的下载 URL 不具备抗误改性（A2）
    #[allow(dead_code)]
    url: String,
    #[allow(dead_code)]
    sha256: String,
    name: String,
}

#[derive(Deserialize, Debug)]
struct ManifestJson {
    format_version: u32,
    gen: u64,
    objects: Vec<ManifestObjectJson>,
    volumes: Vec<ManifestVolumeJson>,
}

#[derive(Deserialize, Debug)]
struct ManifestObjectJson {
    key: String,
    volume: String,
    offset: u64,
    size: u64,
    sha256: String,
    content_type: String,
}

#[derive(Deserialize, Debug)]
struct ManifestVolumeJson {
    name: String,
    /// 卷总字节（wire 校验：对象 offset+size 不得越过卷边界）
    size: u64,
}

pub struct ManifestSource {
    cfg: std::sync::Arc<Config>,
    /// 指针/清单专用客户端（带总超时；对象回源用 media.rs 的无总超时客户端）
    http: reqwest::Client,
    index: RwLock<Option<std::sync::Arc<ManifestIndex>>>,
    etag_current: Mutex<Option<String>>,
    last_attempt: Mutex<Option<Instant>>,
    /// 刷新串行化：并发 miss 只允许一个刷新者（其余等 TTL 判定）
    refresh_lock: tokio::sync::Mutex<()>,
    pub refresh_interval: Duration,
}

impl ManifestSource {
    pub fn new(cfg: std::sync::Arc<Config>) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("gaubee-static-server-cdn-base")
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("manifest http client");
        Self {
            refresh_interval: Duration::from_secs(cfg.manifest.refresh_interval_secs),
            cfg,
            http,
            index: RwLock::new(None),
            etag_current: Mutex::new(None),
            last_attempt: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// 当前 last-known-good 索引（None = source 不可用）
    pub async fn get(&self) -> Option<std::sync::Arc<ManifestIndex>> {
        self.index.read().await.clone()
    }

    /// (gen, 对象数, 加载时刻)——stats 端点用
    pub async fn info(&self) -> Option<(u64, usize, SystemTime)> {
        self.index.read().await.as_ref().map(|i| {
            (
                i.gen,
                i.objects.len(),
                i.loaded_at,
            )
        })
    }

    /// TTL 内直接沿用内存索引（短 TTL 语义）；刷新串行化
    pub async fn refresh_within_ttl(&self) -> Option<std::sync::Arc<ManifestIndex>> {
        let _guard = self.refresh_lock.lock().await;
        let within = {
            // guard 不跨 await：作用域内纯同步判定
            let last = self.last_attempt.lock().unwrap();
            match *last {
                Some(t) => t.elapsed() < self.refresh_interval,
                None => false,
            }
        };
        if within {
            return self.get().await;
        }
        match self.refresh_locked().await {
            Ok(idx) => Some(idx),
            Err(e) => {
                eprintln!("[cdn-media] manifest 刷新失败（保留 last-known-good）：{e}");
                self.get().await
            }
        }
    }

    /// 强制刷新（启动/后台循环调用）
    pub async fn refresh(&self) -> Result<std::sync::Arc<ManifestIndex>, String> {
        let _guard = self.refresh_lock.lock().await;
        self.refresh_locked().await
    }

    /// A2 解析算法：条件拉指针 → sha256 校验 → gen 变了才拉清单 → 原子替换。
    /// 返回新索引；任何失败返回 Err 且内存索引保持不动。
    async fn refresh_locked(&self) -> Result<std::sync::Arc<ManifestIndex>, String> {
        *self.last_attempt.lock().unwrap() = Some(Instant::now());

        let etag = self.etag_current.lock().unwrap().clone();
        let (resp_status, etag_new, body) =
            fetch_with_retry(&self.http, &self.cfg.manifest.current_url, etag.as_deref()).await?;
        *self.etag_current.lock().unwrap() = etag_new;

        let prev_gen = self.get().await.as_ref().map(|i| i.gen);

        let pointer: CurrentJson = match resp_status {
            reqwest::StatusCode::NOT_MODIFIED => {
                // 304：指针未变，沿用内存中的指针语义（gen 不变 → 清单长缓存命中）
                let idx = self.get().await.ok_or_else(|| {
                    "收到 304 但内存无 last-known-good（冷启动首次拉取不应命中 304）".to_owned()
                })?;
                *self.last_attempt.lock().unwrap() = Some(Instant::now());
                return Ok(idx);
            }
            _ => serde_json::from_slice(&body)
                .map_err(|e| format!("解析 current.json 失败：{e}"))?,
        };

        // r5 P0-5：同 gen 不再无条件沿用——指针指纹（manifest_sha256 + manifest_path
        // + 各卷 name/asset_id/sha256）变化 = 指针内容变化，必须重新校验清单并原子
        // 替换索引；指纹一致才走清单长缓存（gen 未变清单按约定永不重写）
        if Some(pointer.gen) == prev_gen {
            if let Some(idx) = self.get().await {
                if pointer_fingerprint(&pointer) == idx.pointer_fingerprint {
                    return Ok(idx);
                }
                eprintln!(
                    "[cdn-media] 指针同 gen（{}）但指纹变化：重新拉取并校验清单",
                    pointer.gen
                );
            }
        }

        // 指针自身一致性：manifest_sha256 必须是 64 位 hex
        let expect_sha = normalize_sha256(&pointer.manifest_sha256)?;

        let manifest_url = manifest_raw_url(&self.cfg.manifest.current_url, &pointer.manifest_path)?;
        let (_, _, manifest_body) = fetch_with_retry(&self.http, &manifest_url, None).await?;

        // 清单 sha256 校验通过才允许替换内存索引
        let actual = hex(&Sha256::digest(&manifest_body));
        if actual != expect_sha {
            return Err(format!(
                "manifest sha256 不匹配：current.json 声明 {expect_sha}，实际 {actual}"
            ));
        }

        let index = build_index(&pointer, &manifest_body)?;

        // 原子替换内存索引（写入 RwLock 即整体切换）
        let arc = std::sync::Arc::new(index);
        *self.index.write().await = Some(arc.clone());
        eprintln!(
            "[cdn-media] manifest 已加载：gen={} objects={} volumes={}",
            arc.gen,
            arc.objects.len(),
            arc.volume_assets.len()
        );
        Ok(arc)
    }
}

/// 指针指纹（r5 P0-5）：manifest_sha256 + manifest_path + 各卷 (name, asset_id,
/// sha256) 的 sha256。同 gen 下任何指针字段变化都会改变指纹 → 触发清单重校验。
fn pointer_fingerprint(p: &CurrentJson) -> String {
    let mut h = Sha256::new();
    h.update(p.manifest_sha256.as_bytes());
    h.update(b"\n");
    h.update(p.manifest_path.as_bytes());
    h.update(b"\n");
    for v in &p.volumes {
        h.update(v.name.as_bytes());
        h.update(b"|");
        h.update(v.asset_id.to_string().as_bytes());
        h.update(b"|");
        h.update(v.sha256.as_bytes());
        h.update(b"\n");
    }
    hex(&h.finalize())
}

/// 对象 key 路径格式（r5 P1-6）：固定 `<source>/<YYYY-MM>/<file>` 三段式
fn validate_object_key(key: &str) -> Result<(), String> {
    crate::config::validate_key(key).map_err(|e| format!("key 字符集/段非法：{e}"))?;
    let parts: Vec<&str> = key.split('/').collect();
    if parts.len() != 3 {
        return Err(format!("key 必须形如 <source>/<YYYY-MM>/<file>（当前 {key:?}）"));
    }
    let month = parts[1];
    let b = month.as_bytes();
    if month.len() != 7
        || !b.iter().enumerate().all(|(i, c)| match i {
            4 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
    {
        return Err(format!("key 月份段必须是 YYYY-MM（当前 {key:?}）"));
    }
    Ok(())
}

fn build_index(pointer: &CurrentJson, manifest_body: &[u8]) -> Result<ManifestIndex, String> {
    // wire 校验（r5 P1-6）：format_version 冻结为 1
    let manifest: ManifestJson =
        serde_json::from_slice(manifest_body).map_err(|e| format!("解析清单失败：{e}"))?;
    if manifest.format_version != 1 {
        return Err(format!(
            "format_version = {} 不受支持（仅支持 1）",
            manifest.format_version
        ));
    }
    if manifest.gen != pointer.gen {
        return Err(format!(
            "清单 gen({}) 与指针 gen({}) 不一致",
            manifest.gen, pointer.gen
        ));
    }

    // 指针侧：asset_id > 0、卷名/sha 合法、无重复
    let mut volume_assets = HashMap::with_capacity(pointer.volumes.len());
    for v in &pointer.volumes {
        if v.name.is_empty() {
            return Err("current.json 含空卷名".to_owned());
        }
        if v.asset_id == 0 {
            return Err(format!("current.json 卷 {} 的 asset_id 必须为正整数", v.name));
        }
        normalize_sha256(&v.sha256).map_err(|e| format!("current.json 卷 {} sha256 非法：{e}", v.name))?;
        if volume_assets.insert(v.name.clone(), v.asset_id).is_some() {
            return Err(format!("current.json 卷名重复：{}", v.name));
        }
    }

    // 清单侧卷表：名字唯一 + 与指针卷集合完全一致（双向）
    let mut volume_sizes: HashMap<&str, u64> = HashMap::with_capacity(manifest.volumes.len());
    for v in &manifest.volumes {
        if v.name.is_empty() {
            return Err("清单含空卷名".to_owned());
        }
        if volume_sizes.insert(v.name.as_str(), v.size).is_some() {
            return Err(format!("清单卷名重复：{}", v.name));
        }
    }
    for name in volume_sizes.keys() {
        if !volume_assets.contains_key(*name) {
            return Err(format!("清单卷 {name} 在 current.json 无 asset id（清单与指针不同代？）"));
        }
    }
    for name in volume_assets.keys() {
        if !volume_sizes.contains_key(name.as_str()) {
            return Err(format!("current.json 卷 {name} 不在清单中（清单与指针不同代？）"));
        }
    }

    let mut objects = HashMap::with_capacity(manifest.objects.len());
    for o in &manifest.objects {
        validate_object_key(&o.key).map_err(|e| format!("清单键非法（{}）：{e}", o.key))?;
        let Some(&vol_size) = volume_sizes.get(o.volume.as_str()) else {
            return Err(format!(
                "对象 {} 引用清单未声明的卷 {}",
                o.key, o.volume
            ));
        };
        // offset 必须 512 对齐（A1 USTAR 数据块边界）
        if o.offset % 512 != 0 {
            return Err(format!(
                "对象 {} offset({}) 未按 512 字节对齐",
                o.key, o.offset
            ));
        }
        // offset+size ≤ 卷 size（checked arithmetic，防回绕越过校验）
        let end = o
            .offset
            .checked_add(o.size)
            .ok_or_else(|| format!("对象 {} offset+size 溢出（{}+{}）", o.key, o.offset, o.size))?;
        if end > vol_size {
            return Err(format!(
                "对象 {} 越过卷边界：offset({})+size({})={} > 卷 {} size({})",
                o.key, o.offset, o.size, end, o.volume, vol_size
            ));
        }
        if o.content_type.is_empty() || !o.content_type.contains('/') {
            return Err(format!("对象 {} content_type 非法：{:?}", o.key, o.content_type));
        }
        normalize_sha256(&o.sha256).map_err(|e| format!("对象 {} sha256 非法：{e}", o.key))?;
        if objects.insert(
            o.key.clone(),
            MediaObject {
                volume: o.volume.clone(),
                offset: o.offset,
                size: o.size,
                sha256: o.sha256.clone(),
                content_type: o.content_type.clone(),
            },
        )
        .is_some()
        {
            return Err(format!("清单键重复：{}", o.key));
        }
    }
    Ok(ManifestIndex {
        gen: manifest.gen,
        objects,
        volume_assets,
        loaded_at: SystemTime::now(),
        pointer_fingerprint: pointer_fingerprint(pointer),
        url_base: "https://api.github.com".to_owned(),
    })
}

/// current.json 同目录约定（A2：指针与清单都在仓库 manifest/ 目录）：
/// manifest_path 是仓库根相对路径 → 分支根 = current.json 目录的上一级
fn manifest_raw_url(current_url: &str, manifest_path: &str) -> Result<String, String> {
    let dir = current_url
        .rsplit_once('/')
        .map(|(p, _)| p)
        .ok_or_else(|| format!("current_url 缺少路径分隔符：{current_url}"))?;
    let branch_root = dir
        .rsplit_once('/')
        .map(|(p, _)| p)
        .ok_or_else(|| format!("current_url 缺少分支段：{current_url}"))?;
    Ok(format!("{branch_root}/{manifest_path}"))
}

fn normalize_sha256(s: &str) -> Result<String, String> {
    let lower = s.to_ascii_lowercase();
    if lower.len() == 64 && lower.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(lower)
    } else {
        Err(format!("sha256 必须是 64 位 hex：{s:?}"))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 带重试的条件 GET：重试 4 次、退避 3/6/12/24s（演练实测定死）。
/// 404 不重试（指针缺失是确定性问题）；304/2xx 直接返回。
/// 返回（最终状态码，ETag，body——304 时 body 为空）。
async fn fetch_with_retry(
    http: &reqwest::Client,
    url: &str,
    etag: Option<&str>,
) -> Result<(reqwest::StatusCode, Option<String>, Vec<u8>), String> {
    let mut last_err = String::new();
    for attempt in 0..=RETRY_DELAYS_SECS.len() {
        if attempt > 0 {
            let delay = RETRY_DELAYS_SECS[attempt - 1];
            eprintln!(
                "[cdn-media] 拉取失败（第 {attempt} 次重试，退避 {delay}s）：{url}：{last_err}"
            );
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
        let mut req = http.get(url);
        if let Some(tag) = etag {
            req = req.header(reqwest::header::IF_NONE_MATCH, tag);
        }
        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                let etag = resp
                    .headers()
                    .get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_owned());
                if status.is_success() || status == reqwest::StatusCode::NOT_MODIFIED {
                    let body = if status == reqwest::StatusCode::NOT_MODIFIED {
                        Vec::new()
                    } else {
                        resp.bytes()
                            .await
                            .map_err(|e| format!("读响应体失败：{e}"))?
                            .to_vec()
                    };
                    return Ok((status, etag, body));
                }
                if status == reqwest::StatusCode::NOT_FOUND {
                    return Err(format!("404（不重试）：{url}"));
                }
                last_err = format!("HTTP {status}");
            }
            Err(e) => {
                last_err = format!("{e}");
            }
        }
    }
    Err(format!("重试 {} 次后仍失败：{url}：{last_err}", RETRY_DELAYS_SECS.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::test_support::{
        make_fixture, sha256_hex, spawn_manifest_mock, ManifestMockState,
    };

    #[test]
    fn manifest_raw_url_joins_pointer_path() {
        let url = manifest_raw_url(
            "https://raw.githubusercontent.com/Gaubee/cdn-media.gaubee.com/main/manifest/current.json",
            "manifest/manifest-1.json",
        )
        .unwrap();
        assert_eq!(
            url,
            "https://raw.githubusercontent.com/Gaubee/cdn-media.gaubee.com/main/manifest/manifest-1.json"
        );
    }

    #[test]
    fn build_index_from_real_manifest_fixture() {
        // 用子仓真实 manifest 产物（gen 1）喂解析器：字段语义 + 一致性 + r5 P1-6
        // 全量 wire 校验（format_version/offset 对齐/卷边界/卷集合一致/key 路径格式）
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../cdn-media");
        let raw = match std::fs::read(fixture.join("manifest/manifest-1.json")) {
            Ok(r) => r,
            Err(_) => {
                eprintln!("skip：本地无 cdn-media manifest fixture（CI 场景）");
                return;
            }
        };
        let pointer: CurrentJson = serde_json::from_str(
            &std::fs::read_to_string(fixture.join("manifest/current.json")).unwrap(),
        )
        .unwrap();
        let idx = build_index(&pointer, &raw).expect("真实清单必须可构建索引（r5 P1-6 校验全过）");
        assert_eq!(idx.gen, 1);
        assert!(idx.objects.len() >= 3413);
        let obj = idx.lookup("x/1970-01/1004445344514572290-poster.jpg").unwrap();
        assert_eq!(obj.offset, 512);
        assert_eq!(obj.size, 33861);
        assert_eq!(obj.content_type, "image/jpeg");
        assert_eq!(
            idx.volume_assets.get("vol-1970-01-001.tar"),
            Some(&615171231)
        );
        // 对象回源 URL 必须是 asset id API URL（A2）
        assert!(idx
            .object_url("Gaubee/cdn-media.gaubee.com", obj)
            .unwrap()
            .starts_with("https://api.github.com/repos/Gaubee/cdn-media.gaubee.com/releases/assets/"));
    }

    #[test]
    fn build_index_rejects_bad_key() {
        let raw = br#"{"format_version":1,"gen":1,"objects":[{"key":"x/a%b.jpg","volume":"v","offset":0,"size":1,"sha256":"xx","content_type":"image/png"}],"volumes":[{"name":"v","size":1024}]}"#;
        let pointer = CurrentJson {
            gen: 1,
            manifest_sha256: "00".repeat(32),
            manifest_path: "manifest/manifest-1.json".into(),
            volumes: vec![],
        };
        assert!(build_index(&pointer, raw).is_err());
    }

    // ---- r5 P0-5：指针指纹 ----

    fn pointer_json(gen: u64, manifest_sha: &str, volumes: &str) -> String {
        format!(
            r#"{{"gen":{gen},"manifest_sha256":"{manifest_sha}","manifest_path":"manifest/manifest-{gen}.json","volumes":[{volumes}]}}"#
        )
    }

    #[test]
    fn pointer_fingerprint_changes_with_pointer_content() {
        let parse = |s: &str| -> CurrentJson { serde_json::from_str(s).unwrap() };
        let hex1 = "aa".repeat(32);
        let hex2 = "cc".repeat(32);
        let vol_sha = "bb".repeat(32);
        let p1 = parse(&pointer_json(
            1,
            &hex1,
            &format!(r#"{{"asset_id":1,"url":"u","sha256":"{vol_sha}","name":"v1"}}"#),
        ));
        let p2 = parse(&pointer_json(
            1,
            &hex1,
            &format!(r#"{{"asset_id":2,"url":"u","sha256":"{vol_sha}","name":"v1"}}"#),
        ));
        let p3 = parse(&pointer_json(
            1,
            &hex2,
            &format!(r#"{{"asset_id":1,"url":"u","sha256":"{vol_sha}","name":"v1"}}"#),
        ));
        let p4 = parse(&pointer_json(
            1,
            &hex1,
            &format!(r#"{{"asset_id":1,"url":"u","sha256":"{vol_sha}","name":"v1"}}"#),
        ));
        assert_ne!(pointer_fingerprint(&p1), pointer_fingerprint(&p2), "asset_id 变化必须改指纹");
        assert_ne!(pointer_fingerprint(&p1), pointer_fingerprint(&p3), "manifest_sha256 变化必须改指纹");
        assert_eq!(pointer_fingerprint(&p1), pointer_fingerprint(&p4), "内容相同的指针指纹一致");
        // build_index 产出的索引携带指纹
        let manifest_body = format!(
            r#"{{"format_version":1,"gen":1,"objects":[],"volumes":[{{"name":"v1","size":1024,"sha256":"{vol_sha}","asset_name":"v1"}}]}}"#
        );
        let idx = build_index(&p1, manifest_body.as_bytes()).unwrap();
        assert_eq!(idx.pointer_fingerprint, pointer_fingerprint(&p1));
    }

    // ---- r5 P1-6：wire 校验矩阵（畸形 manifest 必须整体拒绝，保 LKG 不产部分索引） ----

    const HEX_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HEX_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const HEX_C: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    const GOOD_MANIFEST: &str = r#"{"format_version":1,"gen":1,"objects":[{"key":"x/1970-01/a.jpg","volume":"v1","offset":512,"size":3,"sha256":"HEX_A","content_type":"image/jpeg"}],"volumes":[{"name":"v1","size":2048,"sha256":"HEX_B","asset_name":"v1"}]}"#;
    const GOOD_POINTER: &str = r#"{"gen":1,"manifest_sha256":"HEX_C","manifest_path":"manifest/manifest-1.json","volumes":[{"asset_id":7,"url":"u","sha256":"HEX_B","name":"v1"}]}"#;

    fn wire_case(name: &str, manifest: &str, pointer: &str, expect_err: bool) {
        let p: CurrentJson = serde_json::from_str(pointer).unwrap();
        let r = build_index(&p, manifest.as_bytes());
        assert_eq!(r.is_err(), expect_err, "case {name}");
    }

    #[test]
    fn wire_validation_matrix() {
        // 合法基线
        wire_case(
            "good",
            &GOOD_MANIFEST.replace("HEX_A", HEX_A).replace("HEX_B", HEX_B),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            false,
        );
        // format_version 冻结为 1
        wire_case(
            "format_version=2",
            GOOD_MANIFEST
                .replace("format_version\":1", "format_version\":2")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // asset_id 必须 > 0
        wire_case(
            "asset_id=0",
            &GOOD_MANIFEST.replace("HEX_A", HEX_A).replace("HEX_B", HEX_B),
            GOOD_POINTER
                .replace("\"asset_id\":7", "\"asset_id\":0")
                .replace("HEX_C", HEX_C)
                .replace("HEX_B", HEX_B)
                .as_str(),
            true,
        );
        // offset 必须 512 对齐
        wire_case(
            "offset 未对齐",
            GOOD_MANIFEST
                .replace("\"offset\":512", "\"offset\":513")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // offset+size 越过卷 size（checked）
        wire_case(
            "越过卷边界",
            GOOD_MANIFEST
                .replace("\"size\":2048", "\"size\":514")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // offset+size 溢出（回绕不得绕过校验）
        wire_case(
            "offset+size 溢出",
            GOOD_MANIFEST
                .replace("\"offset\":512", "\"offset\":18446744073709551615")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // 指针卷集合与清单卷集合必须完全一致（指针多）
        wire_case(
            "指针多卷",
            &GOOD_MANIFEST.replace("HEX_A", HEX_A).replace("HEX_B", HEX_B),
            GOOD_POINTER
                .replace(
                    r#""name":"v1"}]"#,
                    r#""name":"v1"},{"asset_id":8,"url":"u","sha256":"HEX_B","name":"v2"}]"#,
                )
                .replace("HEX_C", HEX_C)
                .replace("HEX_B", HEX_B)
                .as_str(),
            true,
        );
        // 清单卷集合与指针卷集合必须完全一致（清单多）
        wire_case(
            "清单多卷",
            GOOD_MANIFEST
                .replace(
                    r#""asset_name":"v1"}]"#,
                    r#""asset_name":"v1"},{"name":"v2","size":1024,"sha256":"HEX_B","asset_name":"v2"}]"#,
                )
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // key 路径格式：两段式（缺月份段）
        wire_case(
            "key 两段",
            GOOD_MANIFEST
                .replace("x/1970-01/a.jpg", "x/a.jpg")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // key 路径格式：月份段非 YYYY-MM
        wire_case(
            "key 月份非法",
            GOOD_MANIFEST
                .replace("1970-01", "1970-1")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // key 路径格式：四段式
        wire_case(
            "key 四段",
            GOOD_MANIFEST
                .replace("x/1970-01/a.jpg", "x/1970-01/sub/a.jpg")
                .replace("HEX_A", HEX_A)
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
        // 卷名重复（指针）
        wire_case(
            "指针卷名重复",
            &GOOD_MANIFEST.replace("HEX_A", HEX_A).replace("HEX_B", HEX_B),
            GOOD_POINTER
                .replace(
                    r#""name":"v1"}]"#,
                    r#""name":"v1"},{"asset_id":8,"url":"u","sha256":"HEX_B","name":"v1"}]"#,
                )
                .replace("HEX_C", HEX_C)
                .replace("HEX_B", HEX_B)
                .as_str(),
            true,
        );
        // 对象 sha256 非 hex
        wire_case(
            "sha 非 hex",
            GOOD_MANIFEST
                .replace("HEX_A", "zz")
                .replace("HEX_B", HEX_B)
                .as_str(),
            &GOOD_POINTER.replace("HEX_C", HEX_C).replace("HEX_B", HEX_B),
            true,
        );
    }

    #[test]
    fn object_key_month_format_matrix() {
        assert!(validate_object_key("x/1970-01/a.jpg").is_ok());
        assert!(validate_object_key("misc/2024-12/v.mp4").is_ok());
        assert!(validate_object_key("x/1970-1/a.jpg").is_err());
        assert!(validate_object_key("x/19700-01/a.jpg").is_err());
        assert!(validate_object_key("x/1970-0a/a.jpg").is_err());
        assert!(validate_object_key("x/1970_01/a.jpg").is_err());
        assert!(validate_object_key("x/a.jpg").is_err());
        assert!(validate_object_key("x/1970-01").is_err());
        assert!(validate_object_key("x/1970-01/a/b.jpg").is_err());
        assert!(validate_object_key("").is_err());
    }

    // ---- r5 P0-5/P1-6 集成：refresh 全链路（mock 上游）----
    // - 同 gen 指纹不变 → 清单长缓存命中（不重拉）
    // - 同 gen 指纹变化（asset_id 改）→ 重新校验并原子替换
    // - 畸形清单（sha 对得上但 wire 非法）→ 整体拒绝，LKG 原样保留

    #[tokio::test]
    async fn refresh_fingerprint_and_lkg_semantics() {
        let fixture = make_fixture(1, 111, "http://mock");
        let state = Arc::new(ManifestMockState::default());
        state
            .bodies
            .lock()
            .unwrap()
            .insert("/manifest/current.json".to_owned(), fixture.pointer_json.clone().into_bytes());
        state.bodies.lock().unwrap().insert(
            "/manifest/manifest-1.json".to_owned(),
            fixture.manifest_json.clone().into_bytes(),
        );
        let addr = spawn_manifest_mock(state.clone()).await;

        let cfg = Arc::new(crate::test_support::test_config_default_cache(
            format!("http://{addr}/manifest/current.json"),
            std::env::temp_dir().join(format!("cdn-manifest-test-{}", std::process::id())).display().to_string(),
        ));
        let src = ManifestSource::new(cfg);

        // 1) 首次刷新：拉指针 + 拉清单
        let idx1 = src.refresh().await.expect("首次刷新必须成功");
        assert_eq!(idx1.gen, 1);
        assert_eq!(idx1.volume_assets.get(fixture.volume_name), Some(&111));
        assert_eq!(state.manifest_hits.load(std::sync::atomic::Ordering::SeqCst), 1);

        // 2) 同 gen 同指纹：清单长缓存命中，不重拉
        let idx2 = src.refresh().await.expect("二次刷新必须成功");
        assert_eq!(
            state.manifest_hits.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "同 gen 指纹不变不得重拉清单"
        );
        assert!(Arc::ptr_eq(&idx1, &idx2), "应原样沿用内存索引");

        // 3) 同 gen 指纹变化（asset_id 111 → 222）：必须重新拉清单并原子替换
        let fixture2 = make_fixture(1, 222, "http://mock");
        *state.bodies.lock().unwrap().get_mut("/manifest/current.json").unwrap() =
            fixture2.pointer_json.clone().into_bytes();
        let idx3 = src.refresh().await.expect("指纹变化后刷新必须成功");
        assert_eq!(
            state.manifest_hits.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "同 gen 指纹变化必须重新校验清单"
        );
        assert_eq!(
            idx3.volume_assets.get(fixture.volume_name),
            Some(&222),
            "指针变化必须反映到索引"
        );
        assert_ne!(idx3.pointer_fingerprint, idx1.pointer_fingerprint);

        // 4) 畸形清单（指针 sha 与 body 一致、但 wire 非法：offset 未对齐）→
        //    整体拒绝，LKG 原样保留（绝不产部分索引）
        let bad_manifest = fixture.manifest_json.replace("\"offset\": 512", "\"offset\": 513");
        let bad_pointer = format!(
            r#"{{"gen":1,"manifest_sha256":"{msha}","manifest_path":"manifest/manifest-1.json","volumes":[{{"asset_id":333,"url":"http://mock/x","sha256":"{vsha}","name":"{vol}"}}]}}"#,
            msha = sha256_hex(bad_manifest.as_bytes()),
            vsha = sha256_hex(fixture.volume_name.as_bytes()),
            vol = fixture.volume_name,
        );
        {
            let mut bodies = state.bodies.lock().unwrap();
            bodies.get_mut("/manifest/current.json").unwrap().clear();
            bodies.get_mut("/manifest/current.json").unwrap().extend_from_slice(bad_pointer.as_bytes());
            bodies.get_mut("/manifest/manifest-1.json").unwrap().clear();
            bodies.get_mut("/manifest/manifest-1.json").unwrap().extend_from_slice(bad_manifest.as_bytes());
        }
        let err = src.refresh().await.expect_err("畸形清单必须整体拒绝");
        assert!(err.contains("512"), "拒绝原因应为 wire 校验失败：{err}");
        let lkg = src.get().await.expect("LKG 必须保留");
        assert_eq!(
            lkg.volume_assets.get(fixture.volume_name),
            Some(&222),
            "LKG 指针不得被畸形清单污染"
        );
        assert_eq!(lkg.pointer_fingerprint, idx3.pointer_fingerprint);
    }
}
