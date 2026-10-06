//! USTAR 头解析（A1：未压缩 USTAR、512 字节块对齐）。
//!
//! 运行时不解卷——对象按 manifest 的 offset/size 直接对卷发 HTTP Range 取字节。
//! 本模块仅供测试：用 cdn-media/staging/ 本地卷核对「manifest offset 定位」语义
//!（header 名单/size 八进制/数据起始 offset 三方一致 + 对象字节 sha256 对账）。

use std::path::Path;

/// 单个卷条目（从 USTAR 头解析）
pub struct UstarEntry {
    pub name: String,
    pub size: u64,
    /// 数据块起始 offset（= header block offset + 512）
    pub data_offset: u64,
}

const BLOCK: u64 = 512;

fn parse_header(block: &[u8; 512]) -> Option<UstarEntry> {
    // 全零块 = 卷尾（两连零块，这里见到首块即可停止）
    if block.iter().all(|b| *b == 0) {
        return None;
    }
    let name_end = block[..100]
        .iter()
        .position(|b| *b == 0)
        .unwrap_or(100);
    let name = String::from_utf8_lossy(&block[..name_end]).into_owned();
    // size：124..136 八进制 ASCII（NUL/空格填充）
    let size_field = std::str::from_utf8(&block[124..136]).unwrap_or("");
    let size_str = size_field.trim_matches(|c| c == '\0' || c == ' ');
    let size = u64::from_str_radix(size_str, 8).ok()?;
    // magic：257..262 "ustar"
    if &block[257..262] != b"ustar" {
        return None;
    }
    Some(UstarEntry {
        name,
        size,
        data_offset: 0,
    })
}

/// 扫描整个卷，返回全部条目（name/size/数据起始 offset）
pub fn scan(path: &Path) -> std::io::Result<Vec<UstarEntry>> {
    let data = std::fs::read(path)?;
    Ok(scan_bytes(&data))
}

pub fn scan_bytes(data: &[u8]) -> Vec<UstarEntry> {
    let mut out = Vec::new();
    let mut off = 0u64;
    while (off as usize) + 512 <= data.len() {
        let mut block = [0u8; 512];
        block.copy_from_slice(&data[off as usize..(off + 512) as usize]);
        match parse_header(&block) {
            None => break,
            Some(mut e) => {
                e.data_offset = off + BLOCK;
                let step = BLOCK + e.size.div_ceil(BLOCK) * BLOCK;
                out.push(e);
                off += step;
            }
        }
    }
    out
}

/// 读取卷内对象字节（按 offset 定位，不解析头——与运行时 Range 取字节同语义）
pub fn read_object_bytes(path: &Path, offset: u64, size: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; size as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::sync::LazyLock;

    static MANIFEST: LazyLock<Option<serde_json::Value>> = LazyLock::new(|| {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../cdn-media");
        serde_json::from_str(
            &std::fs::read_to_string(base.join("manifest/manifest-1.json")).ok()?,
        )
        .ok()
    });

    fn staging_volume(name: &str) -> Option<std::path::PathBuf> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../cdn-media/staging")
            .join(name);
        p.is_file().then_some(p)
    }

    #[test]
    fn ustar_offset_locates_manifest_objects() {
        let Some(m) = MANIFEST.as_ref() else {
            eprintln!("skip：本地无 cdn-media manifest fixture（CI 场景）");
            return;
        };
        let volume_path = staging_volume("vol-1970-01-001.tar").expect("staging 卷必须存在");
        let entries = scan(&volume_path).expect("卷可解析");
        assert!(!entries.is_empty());
        // 卷头扫描结果与 manifest 对账：每个 manifest 对象的 offset/size/sha256
        // 都必须能被 ustar 定位验证
        let by_offset: std::collections::HashMap<u64, &UstarEntry> =
            entries.iter().map(|e| (e.data_offset, e)).collect();
        let objects: Vec<&serde_json::Value> = m["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|o| o["volume"] == "vol-1970-01-001.tar")
            .collect();
        assert!(objects.len() > 100, "该卷应含数百对象");
        for o in &objects {
            let offset = o["offset"].as_u64().unwrap();
            let size = o["size"].as_u64().unwrap();
            let key = o["key"].as_str().unwrap();
            let entry = by_offset.get(&offset).unwrap_or_else(|| panic!("offset {offset} 无头（{key}）"));
            assert_eq!(entry.name, key, "头名字段与 manifest key 一致");
            assert_eq!(entry.size, size, "头 size 与 manifest size 一致");
            // 数据字节 sha256 对账（抽样 30 个控制耗时）
            let digest = Sha256::digest(read_object_bytes(&volume_path, offset, size).unwrap());
            let actual: String = digest.iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(
                actual,
                o["sha256"].as_str().unwrap(),
                "对象字节与 manifest sha256 一致（{key}）"
            );
        }
    }

    #[test]
    fn scan_stops_at_zero_block() {
        // 单文件小卷：header + data(1 块) + 双零块 + 垃圾尾巴
        let mut data = vec![0u8; 512];
        let name = b"x/a.jpg";
        data[..name.len()].copy_from_slice(name);
        data[124..136].copy_from_slice(b"00000000001\0"); // size=1（八进制）
        data[257..262].copy_from_slice(b"ustar");
        data.push(b'Z');
        data.resize(512 + 512 + 1024, 0); // 数据补齐 + 双零块
        data.extend_from_slice(b"garbage-after-end");
        let entries = scan_bytes(&data);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "x/a.jpg");
        assert_eq!(entries[0].size, 1);
        assert_eq!(entries[0].data_offset, 512);
    }
}
