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
}

impl ManifestIndex {
    pub fn lookup(&self, key: &str) -> Option<&MediaObject> {
        self.objects.get(key)
    }

    /// 对象的回源 URL：asset id API URL（A2 契约，见模块头注）
    pub fn object_url(&self, repo: &str, obj: &MediaObject) -> Option<String> {
        let asset_id = self.volume_assets.get(&obj.volume)?;
        Some(format!(
            "https://api.github.com/repos/{repo}/releases/assets/{asset_id}"
        ))
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
    #[allow(dead_code)]
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

        // gen 未变且已有索引：清单按约定永不重写 → 直接沿用（长缓存）
        if Some(pointer.gen) == prev_gen {
            if let Some(idx) = self.get().await {
                return Ok(idx);
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

fn build_index(pointer: &CurrentJson, manifest_body: &[u8]) -> Result<ManifestIndex, String> {
    let manifest: ManifestJson =
        serde_json::from_slice(manifest_body).map_err(|e| format!("解析清单失败：{e}"))?;
    if manifest.gen != pointer.gen {
        return Err(format!(
            "清单 gen({}) 与指针 gen({}) 不一致",
            manifest.gen, pointer.gen
        ));
    }
    let manifest_volume_names: std::collections::HashSet<&str> =
        manifest.volumes.iter().map(|v| v.name.as_str()).collect();

    let mut volume_assets = HashMap::with_capacity(pointer.volumes.len());
    for v in &pointer.volumes {
        if volume_assets.insert(v.name.clone(), v.asset_id).is_some() {
            return Err(format!("current.json 卷名重复：{}", v.name));
        }
    }

    let mut objects = HashMap::with_capacity(manifest.objects.len());
    for o in &manifest.objects {
        crate::config::validate_key(&o.key).map_err(|e| format!("清单键非法（{}）：{e}", o.key))?;
        if !manifest_volume_names.contains(o.volume.as_str()) {
            return Err(format!(
                "对象 {} 引用清单未声明的卷 {}",
                o.key, o.volume
            ));
        }
        if !volume_assets.contains_key(&o.volume) {
            return Err(format!(
                "对象 {} 的卷 {} 在 current.json 无 asset id（清单与指针不同代？）",
                o.key, o.volume
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
        // 用子仓真实 manifest 产物（gen 1）喂解析器：字段语义 + 一致性校验
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
        let idx = build_index(&pointer, &raw).expect("真实清单必须可构建索引");
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
    }

    #[test]
    fn build_index_rejects_bad_key() {
        let raw = br#"{"format_version":1,"gen":1,"objects":[{"key":"x/a%b.jpg","volume":"v","offset":0,"size":1,"sha256":"xx","content_type":"image/png"}],"volumes":[{"name":"v"}]}"#;
        let pointer = CurrentJson {
            gen: 1,
            manifest_sha256: "00".repeat(32),
            manifest_path: "manifest/manifest-1.json".into(),
            volumes: vec![],
        };
        assert!(build_index(&pointer, raw).is_err());
    }
}
