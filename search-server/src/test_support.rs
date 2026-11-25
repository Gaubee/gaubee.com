//! 测试用 mock embedding HTTP 服务（不调用真实 magpie，不产生费用）。
#![cfg(test)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum MockMode {
    Success { dim: usize },
    Fail { status: u16 },
}

pub struct MockEmbeddingServer {
    address: String,
    shutdown: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl MockEmbeddingServer {
    pub fn start(mode: MockMode, delay_ms: u64) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定 mock 端口");
        listener
            .set_nonblocking(true)
            .expect("设置 mock listener 非阻塞");
        let address = listener.local_addr().expect("mock 地址").to_string();
        let shutdown = Arc::new(AtomicBool::new(false));
        let flag = shutdown.clone();

        let handle = std::thread::spawn(move || loop {
            if flag.load(Ordering::Relaxed) {
                break;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = handle_connection(stream, mode, delay_ms);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        });

        Self {
            address,
            shutdown,
            handle: Some(handle),
        }
    }

    pub fn url(&self) -> String {
        format!("http://{}/v1/embeddings", self.address)
    }
}

impl Drop for MockEmbeddingServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        // 唤醒非阻塞 accept 循环。
        let _ = TcpStream::connect(&self.address);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_connection(mut stream: TcpStream, mode: MockMode, delay_ms: u64) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_bytes(&buffer, b"\r\n\r\n") {
            break position;
        }
        if buffer.len() > 2 * 1024 * 1024 {
            return Ok(());
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = &buffer[body_start..(body_start + content_length).min(buffer.len())];

    if delay_ms > 0 {
        std::thread::sleep(Duration::from_millis(delay_ms));
    }

    if let MockMode::Fail { status } = mode {
        let reason = match status {
            429 => "Too Many Requests",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            _ => "Error",
        };
        let response =
            format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        stream.write_all(response.as_bytes())?;
        return Ok(());
    }

    let MockMode::Success { dim } = mode else {
        return Ok(());
    };
    let request: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let inputs = request
        .get("input")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let data = inputs
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let text = value.as_str().unwrap_or_default();
            serde_json::json!({
                "object": "embedding",
                "index": index,
                "embedding": mock_vector(text, dim),
            })
        })
        .collect::<Vec<_>>();
    let payload = serde_json::json!({
        "object": "list",
        "model": "mock-embed",
        "data": data,
        "usage": { "prompt_tokens": inputs.len(), "total_tokens": inputs.len() },
    })
    .to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.len(),
        payload
    );
    stream.write_all(response.as_bytes())?;
    Ok(())
}

/// 基于关键词的可复现向量：alpha/rust/异步 → 第 0 维，beta/向量/数据库 → 第 1 维，其余第 2 维。
fn mock_vector(text: &str, dim: usize) -> Vec<f32> {
    let dim = dim.max(3);
    let lower = text.to_lowercase();
    let mut vector = vec![0.0f32; dim];
    let primary = if lower.contains("alpha") || lower.contains("rust") || text.contains("异步") {
        0
    } else if lower.contains("beta")
        || lower.contains("vector")
        || text.contains("向量")
        || text.contains("数据库")
    {
        1
    } else {
        2
    };
    vector[primary] = 1.0;
    vector
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
