//! 有界拉穿磁盘缓存（R3/A3）：
//!
//! - 目录自描述：缓存文件路径 = MEDIA_CACHE_DIR/<canonical key>（key 即路径）
//! - LRU 记账：进程内 std Mutex 保护配额与逐出（禁 atime）；命中节流更新 mtime
//!   （内存 last_touch 即时更新，磁盘 mtime 超 TOUCH_THROTTLE 才写一次）
//! - 重启恢复：启动扫描目录，按文件 mtime 重建 LRU 顺序，超 high 逐出到 low
//! - 入缓存必先 sha256 校验（校验逻辑在 media.rs 的取流路径），失败标 poisoned
//!   拒缓存；poisoned 带过期窗口，任何 map 访问顺带 TTL 清扫（防高基数无界）
//! - 并发同 key miss 去重：per-key tokio Mutex（single-flight；后到者等锁后重查缓存）；
//!   锁释放且无其他持有者后从锁表摘除（防高基数 key 无界增长）
//! - admission 原子预留（r5 P0-4）：入缓存前先预留字节（投影预算 = total + inflight，
//!   与逐出在同一把锁内判定），成功 commit 转正入账、失败/丢弃自动归还——并发 N 个
//!   miss 不可能同时过检查突破 high
//! - 逐出次序（r5 P1-11）：先删文件、成功才摘账；删除失败保留 entry 并标
//!   undiscardable（字节继续计入配额、拒绝新 admission 的腾位），下次 admission
//!   重试删除直到恢复
//! - 磁盘满/超水位：拒绝入缓存仅透传（admission 返回 None，由调用方走透传）

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// 命中节流：内存即时记账，磁盘 mtime 至少间隔此窗口才更新一次
pub const TOUCH_THROTTLE: Duration = Duration::from_secs(60);
/// poisoned 标记有效期：窗口内该 key 不再尝试入缓存（仅透传），到期自动重取
pub const POISONED_TTL: Duration = Duration::from_secs(30);

struct Entry {
    size: u64,
    pinned: bool,
    /// 逐出删除失败标记（r5 P1-11）：字节保留在账上，等待下次删除重试（恢复）
    undiscardable: bool,
    last_touch: Instant,
    last_disk_touch: Instant,
}

#[derive(Default)]
struct CacheInner {
    entries: HashMap<String, Entry>,
    total: u64,
    /// admission 预留中（已过 admission、尚未 commit/release）的字节数：
    /// 投影预算 = total + inflight，防止并发 miss 同时过检查突破 high（r5 P0-4）
    inflight: u64,
}

pub struct DiskCache {
    root: PathBuf,
    high: u64,
    low: u64,
    inner: Mutex<CacheInner>,
    /// 并发同 key miss 去重：等待者拿锁后重查缓存（后到者排队）
    inflight_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
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
                    undiscardable: false,
                    last_touch: last,
                    last_disk_touch: last,
                },
            );
            // r6 P1-8：恢复期记账 checked——异常目录内容导致溢出时启动即败，绝不回绕
            inner.total = inner.total.checked_add(*size).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("缓存恢复总字节溢出（key {key} size {size}）——缓存目录内容异常"),
                )
            })?;
            let _ = mtime;
        }

        let cache = Self {
            root: root.to_owned(),
            high,
            low,
            inner: Mutex::new(inner),
            inflight_locks: Mutex::new(HashMap::new()),
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
                // r6 P1-8：账目收缩用 checked_sub（entry.size 按不变式必计入 total，
                // None 只可能是外部破坏不变式——归零并告警，绝不回绕放大预算）
                let size = entry.size;
                inner.total = inner.total.checked_sub(size).unwrap_or_else(|| {
                    eprintln!("[cdn-media] 缓存账目下溢（total < entry.size）：账目已归零");
                    0
                });
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

    // ---- admission 原子预留（r5 P0-4） ----

    /// 入缓存许可：在 inner 互斥锁内一步完成「投影预算检查（total + inflight + incoming
    /// ≤ high）+ 按需 LRU 逐出 + 预留字节」。返回 None = 拒绝入缓存（调用方透传）。
    /// 许可必须以 [`Reservation::commit`]（转正入账）或 Drop（归还）收口。
    pub fn admit(self: &Arc<Self>, key: &str, incoming: u64) -> Option<Reservation> {
        let mut inner = self.inner.lock().unwrap();
        if incoming > self.high {
            return None;
        }
        // r6 P1-8：inflight 记账 checked——溢出（外部极端输入）拒绝入缓存，不回绕
        let projected_inflight = inner.inflight.checked_add(incoming)?;
        if !self.make_room_locked(&mut inner, incoming, key) {
            return None;
        }
        inner.inflight = projected_inflight;
        Some(Reservation {
            cache: self.clone(),
            key: key.to_owned(),
            bytes: incoming,
            done: false,
        })
    }

    /// 腾位至投影预算（total + inflight + incoming ≤ high）：
    /// 逐出先删文件、成功才摘账（r5 P1-11）；删除失败保留 entry 并标 undiscardable，
    /// 本次调用内换下一个候选（attempted 去重），绝不卡死在单个不可删条目上。
    /// 返回 false = 无法腾出足够空间。
    fn make_room_locked(&self, inner: &mut CacheInner, incoming: u64, key: &str) -> bool {
        let mut attempted: HashSet<String> = HashSet::new();
        loop {
            // r6 P1-8：投影预算 checked——total/inflight/incoming 任一步溢出 = 账目
            // 已被极端输入破坏，拒绝新 admission（fail-safe），绝不回绕绕过 high
            let Some(projected) = inner
                .total
                .checked_add(inner.inflight)
                .and_then(|v| v.checked_add(incoming))
            else {
                eprintln!("[cdn-media] admission 投影预算溢出（拒绝入缓存）");
                return false;
            };
            if projected <= self.high {
                return true;
            }
            match self.remove_victim_locked(inner, key, &mut attempted) {
                // 无候选（全 pinned / 全部删除失败）
                None => return false,
                // 删除失败 → 换下一个候选继续
                Some(false) => continue,
                Some(true) => {}
            }
        }
    }

    /// 选最老候选并尝试删除（r5 P1-11 次序硬约束：先删文件、成功才摘账）。
    /// 返回 None = 无候选者；Some(false) = 删除失败（entry 保留记账、标 undiscardable、
    /// attempted 排除）；Some(true) = 已删除并摘账。
    fn remove_victim_locked(
        &self,
        inner: &mut CacheInner,
        key: &str,
        attempted: &mut HashSet<String>,
    ) -> Option<bool> {
        // 最老优先（last_touch 最小）；pinned、incoming key 自身与本次已失败的条目不选
        let victim = inner
            .entries
            .iter()
            .filter(|(k, e)| !e.pinned && k.as_str() != key && !attempted.contains(k.as_str()))
            .min_by_key(|(_, e)| e.last_touch)
            .map(|(k, _)| k.clone());
        let v = victim?;
        attempted.insert(v.clone());
        let path = self.root.join(&v);
        match std::fs::remove_file(&path) {
            Ok(()) => {
                let e = inner.entries.remove(&v).expect("victim entry 在场");
                // r6 P1-8：账目收缩不回绕（不变式：e.size 必计入 total，饱和仅防御）
                inner.total = inner.total.saturating_sub(e.size);
                Some(true)
            }
            Err(err) => {
                if let Some(entry) = inner.entries.get_mut(&v) {
                    entry.undiscardable = true;
                }
                eprintln!(
                    "[cdn-media] 逐出删除失败（保留记账，标 undiscardable）{}: {err}",
                    path.display()
                );
                Some(false)
            }
        }
    }

    /// 启动/恢复期逐出到 low（pinned 与删除失败者除外）
    fn evict_to_low(&self) {
        let mut inner = self.inner.lock().unwrap();
        let mut attempted: HashSet<String> = HashSet::new();
        while inner.total > self.low {
            match self.remove_victim_locked(&mut inner, "", &mut attempted) {
                None => {
                    eprintln!(
                        "[cdn-media] 水位 {}/{} 无法继续逐出（全部为 pinned 或删除失败 undiscardable）",
                        inner.total, self.high
                    );
                    return;
                }
                Some(false) => continue,
                Some(true) => {}
            }
        }
    }

    // ---- per-key single-flight（r5 P1-12：锁表防无界） ----

    /// 并发同 key miss 去重：返回持有型锁守卫（await 后独占持锁）；
    /// 守卫释放且无其他持有者后自动从锁表摘除该 entry。
    pub async fn lock_key(&self, key: &str) -> KeyLockGuard<'_> {
        let handle = self
            .inflight_locks
            .lock()
            .unwrap()
            .entry(key.to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let guard = Some(handle.clone().lock_owned().await);
        KeyLockGuard {
            cache: self,
            key: key.to_owned(),
            handle,
            guard,
        }
    }

    /// r6 P0-1：流生命周期 flight 锁——返回 **owned**（'static）守卫，供
    /// stream-through 的响应体状态机持有到 finish/abort/Drop 才释放。
    /// 普通 GET tee 在函数返回时响应体仍在下载，借用型守卫会随 `serve` 返回提前
    /// Drop，同 key 并发 miss 就会重复回源——必须用本方法取得可移交的守卫。
    /// 摘表语义与 [`KeyLockGuard`] 完全一致。
    pub async fn lock_key_owned(self: &Arc<Self>, key: &str) -> FlightGuard {
        let handle = self
            .inflight_locks
            .lock()
            .unwrap()
            .entry(key.to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let guard = Some(handle.clone().lock_owned().await);
        FlightGuard {
            cache: self.clone(),
            key: key.to_owned(),
            handle,
            guard,
        }
    }

    // ---- poisoned 标记（r5 P1-12：任何访问顺带 TTL 清扫，防高基数无界） ----

    pub fn is_poisoned(&self, key: &str) -> bool {
        let mut p = self.poisoned.lock().unwrap();
        sweep_poisoned(&mut p);
        p.contains_key(key)
    }

    pub fn mark_poisoned(&self, key: &str) {
        let mut p = self.poisoned.lock().unwrap();
        sweep_poisoned(&mut p);
        p.insert(key.to_owned(), Instant::now());
    }

    pub fn poisoned_count(&self) -> usize {
        let mut p = self.poisoned.lock().unwrap();
        sweep_poisoned(&mut p);
        p.len()
    }

    pub fn stats(&self) -> CacheStats {
        let inner = self.inner.lock().unwrap();
        {
            let mut p = self.poisoned.lock().unwrap();
            sweep_poisoned(&mut p);
        }
        // r6 P1-8：pinned 求和 checked——极端账目下饱和到 u64::MAX（观测面），不 panic
        let pinned_bytes = inner
            .entries
            .values()
            .filter(|e| e.pinned)
            .try_fold(0u64, |acc, e| acc.checked_add(e.size))
            .unwrap_or(u64::MAX);
        CacheStats {
            objects: inner.entries.len(),
            bytes: inner.total,
            high: self.high,
            low: self.low,
            pinned_objects: inner.entries.values().filter(|e| e.pinned).count(),
            pinned_bytes,
            undiscardable: inner.entries.values().filter(|e| e.undiscardable).count(),
            inflight_reserved: inner.inflight,
        }
    }

    #[cfg(test)]
    pub(crate) fn inflight_locks_len(&self) -> usize {
        self.inflight_locks.lock().unwrap().len()
    }

    #[cfg(test)]
    fn force_poisoned_expiry_for_test(&self) {
        let mut p = self.poisoned.lock().unwrap();
        // 以「TTL 窗口之外」的截止线清扫：全部现存时间戳都超窗
        let cutoff = Instant::now() + POISONED_TTL;
        p.retain(|_, t| cutoff.duration_since(*t) < POISONED_TTL);
    }
}

fn sweep_poisoned(p: &mut HashMap<String, Instant>) {
    let now = Instant::now();
    p.retain(|_, t| now.duration_since(*t) < POISONED_TTL);
}

/// admission 预留守卫：admit 时在缓存互斥锁内预留字节（全局投影预算的一部分），
/// 成功 [`Reservation::commit`] 转正为正式入账，失败/丢弃经 Drop 自动归还——
/// 即使调用方在中途 return/panic 也不会泄漏预算（r5 P0-4）。
pub struct Reservation {
    cache: Arc<DiskCache>,
    key: String,
    bytes: u64,
    done: bool,
}

impl Reservation {
    /// 安装完成（rename 已由调用方做）后转正：预留转正式入账
    pub fn commit(mut self, size: u64, pinned: bool) {
        self.done = true;
        let mut inner = self.cache.inner.lock().unwrap();
        inner.inflight = inner.inflight.saturating_sub(self.bytes);
        let now = Instant::now();
        if let Some(old) = inner.entries.insert(
            self.key.clone(),
            Entry {
                size,
                pinned,
                undiscardable: false,
                last_touch: now,
                last_disk_touch: now,
            },
        ) {
            inner.total = inner.total.saturating_sub(old.size);
        }
        // r6 P1-8：total checked——溢出饱和到 u64::MAX（此后 admission 一律拒绝，
        // fail-safe），绝不回绕绕过水位
        inner.total = match inner.total.checked_add(size) {
            Some(t) => t,
            None => {
                eprintln!(
                    "[cdn-media] 缓存账目 total 溢出（饱和至 u64::MAX，后续 admission 将拒绝）"
                );
                u64::MAX
            }
        };
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.done {
            let mut inner = self.cache.inner.lock().unwrap();
            inner.inflight = inner.inflight.saturating_sub(self.bytes);
        }
    }
}

/// r6 P0-1：流生命周期 flight 守卫（owned——'static，可移交流状态机持有）。
/// Drop 语义与 [`KeyLockGuard`] 一致：先释放锁，再在无其他持有者时摘表。
/// tee 路径中它随 TeeState 存活到 finish/abort/客户端断连（响应体被 Drop），
/// 保证同 key 并发 miss 在整个流期间被挡在锁后。
pub struct FlightGuard {
    cache: Arc<DiskCache>,
    key: String,
    handle: Arc<tokio::sync::Mutex<()>>,
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        // 先释放锁（唤醒等待者）
        drop(self.guard.take());
        let mut m = self.cache.inflight_locks.lock().unwrap();
        if Arc::strong_count(&self.handle) == 2
            && m.get(&self.key).is_some_and(|h| Arc::ptr_eq(h, &self.handle))
        {
            m.remove(&self.key);
        }
    }
}

/// per-key single-flight 持有型守卫（r5 P1-12）：Drop 时先释放锁，再在锁表互斥锁内
/// 判定「无其他持有者」后摘表——高基数 key 场景下锁表不无界。
pub struct KeyLockGuard<'a> {
    cache: &'a DiskCache,
    key: String,
    handle: Arc<tokio::sync::Mutex<()>>,
    /// Option 以便 Drop 内显式先释放锁再做计数判定
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
}

impl Drop for KeyLockGuard<'_> {
    fn drop(&mut self) {
        // 先释放锁（唤醒等待者）
        drop(self.guard.take());
        // 持表锁期间不可能出现新的克隆（lock_key 克隆需持同一把表锁）：
        // 强计数 == 2（表 + 自身 handle）即无任何等待者 → 摘表
        let mut m = self.cache.inflight_locks.lock().unwrap();
        if Arc::strong_count(&self.handle) == 2
            && m.get(&self.key).is_some_and(|h| Arc::ptr_eq(h, &self.handle))
        {
            m.remove(&self.key);
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
    /// 删除失败暂不可逐出的对象数（r5 P1-11 观测面）
    pub undiscardable: usize,
    /// admission 预留中（未转正）的字节数（r5 P0-4 观测面）
    pub inflight_reserved: u64,
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

    /// r5 P0-4：N 个不同 key 并发 miss，admission 原子预留保证投影总量不超 high
    #[tokio::test]
    async fn concurrent_admission_never_exceeds_high() {
        let root = tmp_root("admission");
        let cache = Arc::new(DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap());
        let mut joins = Vec::new();
        for i in 0..8 {
            let cache = cache.clone();
            joins.push(tokio::spawn(async move {
                let key = format!("k{i}.bin");
                // admit 与 commit 之间刻意 await，制造「多笔预留同时在册」的并发窗口
                let Some(res) = cache.admit(&key, 400) else {
                    return 0u64;
                };
                tokio::task::yield_now().await;
                let path = cache.path_for(&key);
                std::fs::write(&path, vec![b'x'; 400]).unwrap();
                res.commit(400, false);
                400
            }));
        }
        let mut committed = 0u64;
        for j in joins {
            committed += j.await.unwrap();
        }
        assert!(
            committed <= 1000,
            "admission 预算被突破：committed={committed} > high=1000"
        );
        assert_eq!(cache.total(), committed, "账面 total 必须与实际转正一致");
        let st = cache.stats();
        assert_eq!(st.inflight_reserved, 0, "全部转正后预留必须清零");
        // 预算回笼后新 admission 可用（失败路径归还已生效）
        assert!(cache.admit("late.bin", 400).is_some(), "预算回笼后应可再入");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P0-4：预留 Drop 归还——admit 后不 commit，预算必须可回收
    #[tokio::test]
    async fn reservation_release_on_drop() {
        let root = tmp_root("resdrop");
        let cache = Arc::new(DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap());
        {
            let _res = cache.admit("a.bin", 600).expect("首次可预留");
            assert_eq!(cache.stats().inflight_reserved, 600);
            // 预算被预留占住：600+600 > 1000 → 拒绝
            assert!(cache.admit("b.bin", 600).is_none(), "预留必须计入投影预算");
        } // _res Drop → 归还
        assert_eq!(cache.stats().inflight_reserved, 0, "Drop 必须归还预留");
        assert!(cache.admit("b.bin", 600).is_some(), "归还后可再预留");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-11：先删文件后摘账；删除失败保留 entry（undiscardable）并拒绝腾位，
    /// 权限恢复后重试删除成功（恢复）
    #[test]
    fn eviction_file_first_keeps_entry_on_delete_failure() {
        let root = tmp_root("evictfail");
        write_file(&root.join("sub").join("old.bin"), 400);
        set_mtime(&root.join("sub").join("old.bin"), 100);
        write_file(&root.join("new.bin"), 400);
        set_mtime(&root.join("new.bin"), 50);
        let cache = Arc::new(DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap());
        assert_eq!(cache.total(), 800);

        // sub 目录转只读 → old.bin 不可删
        use std::os::unix::fs::PermissionsExt;
        let mut ro = std::fs::metadata(root.join("sub")).unwrap().permissions();
        ro.set_mode(0o555);
        std::fs::set_permissions(root.join("sub"), ro).unwrap();

        // incoming 400：1200 > 1000 → 先试删 old.bin（失败，保留）→ 再删 new.bin → 400+400=800 ≤ 1000
        let res = cache.admit("fresh.bin", 400).expect("逐出 new.bin 后应可入");
        res.commit(400, false);
        assert!(
            cache.lookup("sub/old.bin").is_some(),
            "删除失败的 entry 必须保留（文件仍在、记账仍在）"
        );
        assert_eq!(cache.stats().undiscardable, 1, "undiscardable 必须可观测");
        assert!(cache.lookup("new.bin").is_none(), "可删的 new.bin 已被逐出");
        assert_eq!(cache.total(), 800);

        // 恢复权限 → 下次 admission 重试删除 old.bin 成功（恢复）
        let mut rw = std::fs::metadata(root.join("sub")).unwrap().permissions();
        rw.set_mode(0o755);
        std::fs::set_permissions(root.join("sub"), rw).unwrap();
        let res2 = cache.admit("fresh2.bin", 400).expect("恢复后应可入");
        res2.commit(400, false);
        assert!(cache.lookup("sub/old.bin").is_none(), "恢复后 undiscardable 被重试逐出");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-12：锁表释放即摘——高基数 key 下锁表不无界
    #[tokio::test]
    async fn lock_table_cleans_after_release() {
        let root = tmp_root("locktable");
        let cache = Arc::new(DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap());
        for i in 0..1000 {
            let g = cache.lock_key(&format!("k{i}")).await;
            assert_eq!(cache.inflight_locks_len(), 1, "持锁期间恰有一个表项");
            drop(g);
            assert_eq!(cache.inflight_locks_len(), 0, "释放且无等待者后必须摘表（第 {i} 个）");
        }
        // 并发等待场景：等待者在场时表项保留，全部释放后摘除
        let g1 = cache.lock_key("shared").await;
        let cache2 = cache.clone();
        let j = tokio::spawn(async move {
            let g2 = cache2.lock_key("shared").await;
            assert_eq!(cache2.inflight_locks_len(), 1, "等待者在场时表项保留");
            drop(g2);
        });
        // g1 释放后 g2 才拿到锁
        drop(g1);
        j.await.unwrap();
        assert_eq!(cache.inflight_locks_len(), 0, "全部释放后摘表");
        std::fs::remove_dir_all(&root).ok();
    }

    /// r5 P1-12：poisoned map TTL 清扫——高基数 key 下不无界
    #[test]
    fn poisoned_map_sweeps_expired() {
        let root = tmp_root("poison-sweep");
        let cache = DiskCache::recover(&root, 1000, 500, &HashSet::new()).unwrap();
        for i in 0..1000 {
            cache.mark_poisoned(&format!("p{i}"));
        }
        assert_eq!(cache.poisoned_count(), 1000);
        cache.force_poisoned_expiry_for_test();
        assert_eq!(cache.poisoned_count(), 0, "过期 poisoned 必须被清扫");
        assert!(!cache.is_poisoned("p0"));
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

    /// admission 拒绝路径：incoming 超 high 直接拒绝；全 pinned 不可逐出拒绝
    #[test]
    fn admission_refuses_when_room_cannot_be_made() {
        let root = tmp_root("admit-refuse");
        write_file(&root.join("p.txt"), 400);
        set_mtime(&root.join("p.txt"), 100);
        let mut pinned = HashSet::new();
        pinned.insert("p.txt".to_owned());
        let cache = Arc::new(DiskCache::recover(&root, 1000, 500, &pinned).unwrap());
        assert_eq!(cache.total(), 400);
        // pinned 400 + incoming 700 = 1100 > 1000，无非 pinned 可逐 → 拒绝
        assert!(cache.admit("big.bin", 700).is_none());
        // incoming 自身超 high → 直接拒绝
        assert!(cache.admit("huge.bin", 2000).is_none());
        // incoming 300：400+300=700 ≤ 1000 → 允许
        assert!(cache.admit("ok.bin", 300).is_some());
        std::fs::remove_dir_all(&root).ok();
    }
}
