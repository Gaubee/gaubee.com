//! 测试专用支撑（仅 cfg(test) 编译）：本地 raw TCP mock 上游 + 测试 Config 构造。
//!
//! 用 raw TCP 而非 axum/hyper 起 mock：对象回源校验（r5 P1-8）必须能构造
//! 「Content-Length 与 body 不符」等协议层说谎的响应，hyper 服务器做不到。

#![cfg(test)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::config::{AdminCfg, CacheCfg, Config, GeoCfg, GithubCfg, ManifestCfg, MediaCfg, SourcesCfg};

/// 测试 Config：cache 水位取小值便于预算测试；current_url 指向 mock
pub fn test_config(current_url: String, cache_dir: String, high: u64, low: u64) -> Config {
    Config {
        version: 1,
        manifest: ManifestCfg {
            current_url,
            refresh_interval_secs: 300,
        },
        github: GithubCfg {
            repo: "test/cdn-media.test".to_owned(),
            token: String::new(),
        },
        sources: SourcesCfg {
            allow: vec!["x".to_owned()],
        },
        cache: CacheCfg {
            dir: cache_dir,
            high_bytes: high,
            low_bytes: low,
            large_object_bytes: 1_000_000,
            strict_integrity: false,
            max_buffer_bytes: 134_217_728,
        },
        pinned: Default::default(),
        admin: AdminCfg::default(),
        media: MediaCfg::default(),
        geo: GeoCfg::default(),
    }
}

/// 默认水位的测试 Config
pub fn test_config_default_cache(current_url: String, cache_dir: String) -> Config {
    test_config(current_url, cache_dir, 1_000_000, 500_000)
}

// ---- raw 对象 mock：完全可控的 206 响应（可说谎） ----

#[derive(Default)]
pub struct ObjectMockState {
    pub status: u16,
    /// Content-Range 头原样值（None = 不发该头）
    pub content_range: Option<String>,
    /// Content-Length 头原样值（None = 用 body 长度）
    pub content_length: Option<String>,
    pub body: Vec<u8>,
    pub hits: AtomicUsize,
    pub last_range: Mutex<Option<String>>,
}

impl ObjectMockState {
    pub fn ok_206(content_range: String, body: Vec<u8>) -> Self {
        Self {
            status: 206,
            content_range: Some(content_range),
            content_length: None,
            body,
            ..Default::default()
        }
    }

    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

/// 起 raw TCP mock：任何路径都回同一份受控响应；记录命中数与最近一次 Range 头
pub async fn spawn_object_mock(state: Arc<Mutex<ObjectMockState>>) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let st = state.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 8192];
                let mut raw = Vec::new();
                // 读到头结束（\r\n\r\n）
                loop {
                    match sock.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            raw.extend_from_slice(&buf[..n]);
                            if raw.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                    }
                }
                let head = String::from_utf8_lossy(&raw);
                let range = head.lines().find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.eq_ignore_ascii_case("range").then(|| v.trim().to_owned())
                });
                // 锁内只取快照、不跨 await（MutexGuard 非 Send）
                let resp: Vec<u8> = {
                    let st = st.lock().unwrap();
                    *st.last_range.lock().unwrap() = range;
                    st.hits.fetch_add(1, Ordering::SeqCst);
                    let mut resp = format!("HTTP/1.1 {} MOCK\r\n", st.status).into_bytes();
                    if let Some(cr) = &st.content_range {
                        resp.extend_from_slice(format!("Content-Range: {cr}\r\n").as_bytes());
                    }
                    let cl = st
                        .content_length
                        .clone()
                        .unwrap_or_else(|| st.body.len().to_string());
                    resp.extend_from_slice(format!("Content-Length: {cl}\r\n\r\n").as_bytes());
                    resp.extend_from_slice(&st.body);
                    resp
                };
                let _ = sock.write_all(&resp).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    addr
}

// ---- raw 指针/清单 mock：可变 body + 命中计数 ----

#[derive(Default)]
pub struct ManifestMockState {
    /// 路径 → 响应 body
    pub bodies: Mutex<HashMap<String, Vec<u8>>>,
    pub pointer_hits: AtomicUsize,
    pub manifest_hits: AtomicUsize,
}

/// 起 raw TCP mock：`/manifest/current.json` 命中 pointer 计数；其余（清单文件）
/// 命中 manifest 计数；未配置的路径回 404
pub async fn spawn_manifest_mock(state: Arc<ManifestMockState>) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            let st = state.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 8192];
                let mut raw = Vec::new();
                loop {
                    match sock.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            raw.extend_from_slice(&buf[..n]);
                            if raw.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                    }
                }
                let head = String::from_utf8_lossy(&raw);
                let path = head
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_owned();
                // 锁内只取快照、不跨 await（MutexGuard 非 Send）
                let respond: Option<Vec<u8>> = {
                    let is_pointer = path.ends_with("/current.json");
                    let body = st.bodies.lock().unwrap().get(&path).cloned();
                    match body {
                        Some(body) => {
                            if is_pointer {
                                st.pointer_hits.fetch_add(1, Ordering::SeqCst);
                            } else {
                                st.manifest_hits.fetch_add(1, Ordering::SeqCst);
                            }
                            Some(
                                format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: \"mock-{path}\"\r\nContent-Length: {}\r\n\r\n",
                                    body.len()
                                )
                                .into_bytes(),
                            )
                            .map(|mut h| {
                                h.extend_from_slice(&body);
                                h
                            })
                        }
                        None => Some(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec()),
                    }
                };
                if let Some(resp) = respond {
                    let _ = sock.write_all(&resp).await;
                }
                let _ = sock.shutdown().await;
            });
        }
    });
    addr
}

/// 64 位 hex sha256（测试 fixture 用）
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(data);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// 测试 manifest fixture：单卷单对象（offset 512、卷 size 2048）
pub struct Fixture {
    pub manifest_json: String,
    pub pointer_json: String,
    pub volume_name: &'static str,
}

pub fn make_fixture(gen: u64, asset_id: u64, url_base: &str) -> Fixture {
    let object_bytes = b"abc".to_vec();
    let key = "x/1970-01/fixture.jpg";
    let volume = "vol-1970-01-001.tar";
    let manifest_json = format!(
        r#"{{
  "format_version": 1,
  "gen": {gen},
  "object_count": 1,
  "objects": [
    {{"key": "{key}", "volume": "{volume}", "offset": 512, "size": 3, "sha256": "{sha}", "content_type": "image/jpeg"}}
  ],
  "volumes": [
    {{"name": "{volume}", "size": 2048, "sha256": "{vsha}", "asset_name": "{volume}"}}
  ]
}}"#,
        key = key,
        volume = volume,
        sha = sha256_hex(&object_bytes),
        vsha = sha256_hex(volume.as_bytes()),
    );
    let pointer_json = format!(
        r#"{{
  "gen": {gen},
  "manifest_sha256": "{msha}",
  "manifest_path": "manifest/manifest-{gen}.json",
  "volumes": [
    {{"asset_id": {asset_id}, "url": "{url_base}/repos/o/r/releases/assets/{asset_id}", "sha256": "{vsha}", "name": "{volume}"}}
  ]
}}"#,
        gen = gen,
        msha = sha256_hex(manifest_json.as_bytes()),
        vsha = sha256_hex(volume.as_bytes()),
    );
    Fixture {
        manifest_json,
        pointer_json,
        volume_name: "vol-1970-01-001.tar",
    }
}
