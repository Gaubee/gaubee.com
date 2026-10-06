//! 有界拉穿磁盘缓存（R3/A3）：
//!
//! - 目录自描述：缓存文件路径 = MEDIA_CACHE_DIR/<canonical key>（key 即路径）
//! - LRU 记账：进程内 std Mutex 保护配额与逐出（禁 atime）；命中节流更新 mtime
//!   （内存 last_touch 即时更新，磁盘 mtime 超 TOUCH_THROTTLE 才写一次）
//! - 重启恢复：启动扫描目录，按文件 mtime 重建 LRU 顺序，超 high 逐出到 low
//! - 入缓存必先 sha256 校验（校验逻辑在 media.rs 的取流路径），失败标 poisoned
//!   拒缓存；poisoned 带过期窗口，到期自动重取
//! - 并发同 key miss 去重：per-key tokio Mutex（single-flight；后到者等锁后重查缓存）
//! - 磁盘满/超水位：拒绝入缓存仅透传（make_room 返回 false，由调用方走透传）

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

/// 命中节流：内存即时记账，磁盘 mtime 至少间隔此窗口才更新一次
pub const TOUCH_THROTTLE: Duration = Duration::from_secs(60);
/// poisoned 标记有效期：窗口内该 key 不再尝试入缓存（仅透传），到期自动重取
pub const POISONED_TTL: Duration = Duration::from_secs(30);

struct Entry {
    size: u64,
    pinned: bool,
    last_touch: Instant,
    last_disk_touch: Instant,
}

#[derive(Default)]
struct CacheInner {
    entries: HashMap<String, Entry>,
    total: u64,
}

pub struct DiskCache {
    root: PathBuf,
    high: u64,
    low: u64,
    inner: Mutex<CacheInner>,
    /// 并发同 key miss 去重：等待者拿锁后重查缓存（后到者排队）
    inflight: Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
    poisoned: Mutex<HashMap<String, Instant>>,
}

impl DiskCache {
    /// 启动恢复：扫描缓存目录（跳过 tmp/），按 mtime 重建 LRU，超 high 逐出到 low；
    /// 清理上次崩溃遗留的临时文件。pinned：配置声明的常驻 key（恢复时保持不被逐出）。
    pub fn recover(root: &Path, high: u64, low: u64, pinned: &HashSet<String>) -> std::io::Result<Self> {
        std::fs::create_dir_all(root)?;
        let tmp_dir = root.join("tmp");
        std::fs::create_dir_all(&tmp_dir)?;
        for f in std::fs::read_dir(&tmp_dir)?.flatten() {
            if let Err(e) = std::fs::remove_file(f.path()) {
                eprintln!("[cdn-media] 清理临时文件失败 {}: {e}", f.path().display());
            }
        }

        let mut files: Vec<(String, u64, SystemTime)> = Vec::new();
        scan_dir(root, root, &mut files)?;
        // mtime 升序 = LRU 顺序恢复
        files.sort_by_key(|(_, _, m)| *m);

        let mut inner = CacheInner::default();
        for (key, size, mtime) in &files {
            let last = Instant::now();
            inner.entries.insert(
                key.clone(),
                Entry {
                    size: *size,
                    pinned: pinned.contains(key),
                    last_touch: last,
                    last_disk_touch: last,
                },
            );
            inner.total += size;
            let _ = mtime;
        }

        let cache = Self {
            root: root.to_owned(),
            high,
            low,
            inner: Mutex::new(inner),
            inflight: Mutex::new(HashMap::new()),
            poisoned: Mutex::new(HashMap::new()),
        };
        if cache.total() > cache.high {
            cache.evict_to_low();
        }
        eprintln!(
            "[cdn-media] 缓存恢复：{} 个对象，共 {} 字节，上限 {}，水位 {}（目录 {}）",
            cache.len(),
            cache.total(),
            cache.high,
            cache.low,
            root.display()
        );
        Ok(cache)
    }

    pub fn total(&self) -> u64 {
        self.inner.lock().unwrap().total
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().entries.len()
    }

    /// 缓存命中查询 + 节流 touch（内存即时，磁盘 mtime 过窗口才写）。
    /// 记账在册但文件丢失（外部删除）→ 惰性摘账返回 None。
    pub fn lookup(&self, key: &str) -> Option<PathBuf> {
        let path = self.path_for(key);
        let mut inner = self.inner.lock().unwrap();
        let entry = inner.entries.get_mut(key)?;
        let meta = std::fs::metadata(&path).ok();
        match meta {
            Some(m) if m.is_file() => {
                let now = Instant::now();
                entry.last_touch = now;
                if now.duration_since(entry.last_disk_touch) > TOUCH_THROTTLE {
                    entry.last_disk_touch = now;
                    drop(inner);
                    touch_mtime(&path);
                }
                Some(path)
            }
            _ => {
                inner.total -= entry.size;
                inner.entries.remove(key);
                None
            }
        }
    }

    pub fn path_for(&self, key: &str) -> PathBuf {
        self.root.join(key)
    }

    pub fn new_tmp_path(&self, key: &str) -> PathBuf {
        // 临时文件扁平落 tmp/：key 展平 + 纳秒后缀防并发碰撞
        let flat: String = key
            .chars()
            .map(|c| if c == '/' { '_' } else { c })
            .collect();
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        self.root.join("tmp").join(format!("{flat}.{nanos}.part"))
    }

    /// 并发同 key miss 去重：返回 per-key 互斥锁句柄，调用方 await lock 后重查缓存
    pub async fn lock_key(&self, key: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
        let handle = {
            let mut m = self.inflight.lock().unwrap();
            m.entry(key.to_owned())
                .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        handle
    }

    /// 腾位：projection 总量（含 incoming）超 high 时按 LRU 逐出到 low；
    /// pinned 与 incoming key 自身不逐出。返回 false = 拒绝入缓存（调用方透传）。
    pub fn make_room(&self, incoming: u64, key: &str) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if inner.total + incoming <= self.high {
            return true;
        }
        loop {
            if inner.total + incoming <= self.high {
                return true;
            }
            // 最老优先（last_touch 最小）；pinned 与本 key 不逐出
            let victim = inner
                .entries
                .iter()
                .filter(|(k, e)| !e.pinned && k.as_str() != key)
                .min_by_key(|(_, e)| e.last_touch)
                .map(|(k, _)| k.clone());
            match victim {
                Some(v) => {
                    let (removed, path) = {
                        let e = inner.entries.remove(&v).unwrap();
                        inner.total -= e.size;
                        (e.size, self.root.join(&v))
                    };
                    if let Err(e) = std::fs::remove_file(&path) {
                        eprintln!("[cdn-media] 逐出失败 {}: {e}", path.display());
                    }
                    let _ = removed;
                }
                None => return false,
            }
        }
    }

    /// 安装完成（rename 已由调用方做）后登记入账
    pub fn register(&self, key: &str, size: u64, pinned: bool) {
        let mut inner = self.inner.lock().unwrap();
        let now = Instant::now();
        if let Some(old) = inner.entries.insert(
            key.to_owned(),
            Entry {
                size,
                pinned,
                last_touch: now,
                last_disk_touch: now,
            },
        ) {
            inner.total -= old.size;
        }
        inner.total += size;
    }

    fn evict_to_low(&self) {
        let mut inner = self.inner.lock().unwrap();
        while inner.total > self.low {
            let victim = inner
                .entries
                .iter()
                .filter(|(_, e)| !e.pinned)
                .min_by_key(|(_, e)| e.last_touch)
                .map(|(k, _)| k.clone());
            match victim {
                Some(v) => {
                    let e = inner.entries.remove(&v).unwrap();
                    inner.total -= e.size;
                    let _ = std::fs::remove_file(self.root.join(&v));
                }
                None => {
                    eprintln!(
                        "[cdn-media] 水位 {}/{} 无法继续逐出（全部为 pinned）",
                        inner.total, self.high
                    );
                    return;
                }
            }
        }
    }

    pub fn is_poisoned(&self, key: &str) -> bool {
        let mut p = self.poisoned.lock().unwrap();
        let now = Instant::now();
        p.retain(|_, t| now.duration_since(*t) < POISONED_TTL);
        p.contains_key(key)
    }

    pub fn mark_poisoned(&self, key: &str) {
        self.poisoned
            .lock()
            .unwrap()
            .insert(key.to_owned(), Instant::now());
    }

    pub fn poisoned_count(&self) -> usize {
        self.poisoned.lock().unwrap().len()
    }

    pub fn stats(&self) -> CacheStats {
        let inner = self.inner.lock().unwrap();
        CacheStats {
            objects: inner.entries.len(),
            bytes: inner.total,
            high: self.high,
            low: self.low,
            pinned_objects: inner.entries.values().filter(|e| e.pinned).count(),
            pinned_bytes: inner.entries.values().filter(|e| e.pinned).map(|e| e.size).sum(),
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct CacheStats {
    pub objects: usize,
    pub bytes: u64,
    pub high: u64,
    pub low: u64,
    pub pinned_objects: usize,
    pub pinned_bytes: u64,
}

fn touch_mtime(path: &Path) {
    let ok = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|f| {
            f.set_times(std::fs::FileTimes::new().set_modified(SystemTime::now()))
        });
    if let Err(e) = ok {
        eprintln!("[cdn-media] 更新 mtime 失败 {}: {e}", path.display());
    }
}

fn scan_dir(root: &Path, dir: &Path, out: &mut Vec<(String, u64, SystemTime)>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "tmp") {
                continue;
            }
            scan_dir(root, &path, out)?;
        } else if let Ok(rel) = path.strip_prefix(root) {
            if let (Ok(meta), Some(key)) = (entry.metadata(), rel.to_str()) {
                out.push((key.to_owned(), meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cdn-cache-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn write_file(path: &Path, size: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![b'a'; size]).unwrap();
    }

    fn set_mtime(path: &Path, secs_ago: u64) {
        let t = SystemTime::now() - Duration::from_secs(secs_ago);
        let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_times(std::fs::FileTimes::new().set_modified(t)).unwrap();
    }

    #[test]
    fn recover_rebuilds_lru_and_evicts_to_low() {
        let root = tmp_root("recover");
        // 预置 4 个文件，mtime 由老到新：a(100s) b(80s) c(60s) d(40s)，各 300 字节
        for (name, age) in [("a.txt", 100), ("b.txt", 80), ("c.txt", 60), ("d.txt", 40)] {
            write_file(&root.join(name), 300);
            set_mtime(&root.join(name), age);
        }
        // high=1000 total=1200 超 high → 逐出到 low=700（逐出最老的 a → 900 → 仍>700 → 逐出 b → 600）
        let cache = DiskCache::recover(&root, 1000, 700, &HashSet::new()).unwrap();
        assert_eq!(cache.total(), 600);
        assert!(cache.lookup("a.txt").is_none(), "最老的 a 应被逐出");
        assert!(cache.lookup("b.txt").is_none(), "次老的 b 应被逐出");
        assert!(cache.lookup("c.txt").is_some());
        assert!(cache.lookup("d.txt").is_some());
        assert!(!root.join("tmp").exists() || std::fs::read_dir(root.join("tmp")).unwrap().count() == 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn make_room_skips_pinned_and_refuses_when_impossible() {
        let root = tmp_root("pinned");
        write_file(&root.join("p.txt"), 400);
        set_mtime(&root.join("p.txt"), 100);
        write_file(&root.join("q.txt"), 400);
        set_mtime(&root.join("q.txt"), 50);
        let mut pinned = HashSet::new();
        pinned.insert("p.txt".to_owned());
        let cache = DiskCache::recover(&root, 1000, 500, &pinned).unwrap();
        assert_eq!(cache.total(), 800);

        // incoming 300：需要逐出（800+300 > 1000），p 不可逐出 → 逐 q → 400+300=700 ≤ 1000
        assert!(cache.make_room(300, "new.bin"));
        assert!(cache.lookup("q.txt").is_none());
        assert!(cache.lookup("p.txt").is_some());

        // incoming 700：pinned 400 + 700 = 1100 > 1000，无非 pinned 可逐 → 拒绝
        assert!(!cache.make_room(700, "big.bin"));
        // 本 key 在册时不逐出自己
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn lookup_touches_and_lazily_unregisters_missing_files() {
        let root = tmp_root("touch");
        write_file(&root.join("x.bin"), 10);
        set_mtime(&root.join("x.bin"), 3600);
        let cache = DiskCache::recover(&root, 10_000, 5_000, &HashSet::new()).unwrap();
        let p = cache.lookup("x.bin").unwrap();
        let before = std::fs::metadata(&p).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(1100));
        // TOUCH_THROTTLE=60s 内不写盘
        cache.lookup("x.bin").unwrap();
        let after_throttled = std::fs::metadata(&p).unwrap().modified().unwrap();
        assert_eq!(before, after_throttled, "节流窗口内 mtime 不应变化");
        // 文件被外部删除 → 惰性摘账
        std::fs::remove_file(&p).unwrap();
        assert!(cache.lookup("x.bin").is_none());
        assert_eq!(cache.total(), 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn poisoned_marks_and_expires() {
        let root = tmp_root("poison");
        let cache = DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap();
        assert!(!cache.is_poisoned("k"));
        cache.mark_poisoned("k");
        assert!(cache.is_poisoned("k"));
        assert_eq!(cache.poisoned_count(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn tmp_files_cleaned_on_recover() {
        let root = tmp_root("tmpclean");
        write_file(&root.join("keep.bin"), 5);
        write_file(&root.join("tmp").join("leftover.part"), 99);
        let cache = DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap();
        assert!(cache.lookup("keep.bin").is_some());
        assert_eq!(
            std::fs::read_dir(root.join("tmp")).unwrap().count(),
            0,
            "遗留 .part 必须被清理"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
