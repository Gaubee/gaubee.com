//! zvec collection 的安全封装：建库、写入、混合检索、统计。
//!
//! 关键语义（与官方 Python 绑定一致）：
//! - COSINE 检索返回的是距离（越小越相似），相似度 = 1 - score；
//! - 混合检索使用多子查询 + RRF（rank_constant 默认 60）；
//! - FTS 使用 jieba tokenizer，默认 OR 连接词项。
use std::ffi::{c_void, CStr, CString};
use std::path::Path;
use std::ptr;
use std::sync::OnceLock;

use anyhow::{bail, Context, Result};

use crate::zvec_ffi::{self as ffi, cstring, field_ptrs};

pub const EMBEDDING_DIM: usize = 384;
pub const COLLECTION_NAME: &str = "gaubee_search";

pub const FIELD_PARENT_ID: &str = "parentId";
pub const FIELD_APP_ID: &str = "appId";
pub const FIELD_TITLE: &str = "title";
pub const FIELD_TAGS: &str = "tags";
pub const FIELD_DATE: &str = "date";
pub const FIELD_CHUNK_INDEX: &str = "chunkIndex";
pub const FIELD_CONTENT_HASH: &str = "contentHash";
pub const FIELD_HREF: &str = "href";
pub const FIELD_TEXT: &str = "text";
pub const FIELD_EMBEDDING: &str = "embedding";

/// 查询返回需要的标量字段。
pub const OUTPUT_FIELDS: &[&str] = &[
    FIELD_PARENT_ID,
    FIELD_APP_ID,
    FIELD_TITLE,
    FIELD_DATE,
    FIELD_CHUNK_INDEX,
    FIELD_HREF,
    FIELD_TEXT,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchMode {
    Hybrid,
    Vector,
    Fts,
}

impl SearchMode {
    pub fn parse(value: &str) -> Result<Self> {
        match value.to_ascii_lowercase().as_str() {
            "" | "hybrid" => Ok(SearchMode::Hybrid),
            "vector" => Ok(SearchMode::Vector),
            "fts" | "fulltext" => Ok(SearchMode::Fts),
            other => bail!("不支持的 mode：{other}（可用 hybrid/vector/fts）"),
        }
    }
}

/// 单条待写入 chunk。
#[derive(Debug, Clone)]
pub struct ChunkDocument<'a> {
    pub id: String,
    pub parent_id: &'a str,
    pub app_id: &'a str,
    pub title: &'a str,
    pub tags: &'a str,
    pub date: i64,
    pub chunk_index: i32,
    pub content_hash: &'a str,
    pub href: &'a str,
    pub text: &'a str,
    pub embedding: &'a [f32],
}

/// 一条检索命中（chunk 粒度）。
#[derive(Debug, Clone)]
pub struct Hit {
    pub parent_id: String,
    pub app_id: String,
    pub title: String,
    pub date: i64,
    pub chunk_index: i32,
    pub href: String,
    pub text: String,
    pub score: f32,
}

/// 进程内 zvec 初始化（只执行一次）。
fn ensure_initialized() -> Result<()> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    let result = INIT.get_or_init(|| unsafe {
        let config = ffi::zvec_config_data_create();
        if config.is_null() {
            return Err("zvec_config_data_create 返回 NULL".to_string());
        }
        if let Err(error) = check(ffi::zvec_config_data_set_memory_limit(
            config,
            1024 * 1024 * 1024,
        )) {
            ffi::zvec_config_data_destroy(config);
            return Err(error.to_string());
        }
        let code = ffi::zvec_initialize(config);
        ffi::zvec_config_data_destroy(config);
        if let Err(error) = check(code) {
            return Err(error.to_string());
        }
        Ok(())
    });
    match result {
        Ok(()) => Ok(()),
        Err(message) => bail!("zvec 初始化失败：{message}"),
    }
}

fn check(code: ffi::zvec_error_code_t) -> Result<()> {
    if code == ffi::ZVEC_OK {
        return Ok(());
    }
    bail!("zvec 错误码 {code}：{}", ffi::take_last_error())
}

/// 官方 SDK 版本（诊断用）。
pub fn sdk_version() -> String {
    unsafe {
        let pointer = ffi::zvec_get_version();
        if pointer.is_null() {
            return "unknown".to_string();
        }
        CStr::from_ptr(pointer).to_string_lossy().into_owned()
    }
}

pub struct ZvecStore {
    collection: *mut ffi::zvec_collection_t,
}

// zvec collection 句柄支持并发读；写入只在构建阶段单线程执行。
unsafe impl Send for ZvecStore {}
unsafe impl Sync for ZvecStore {}

impl ZvecStore {
    /// 新建并打开 collection；调用方负责先清空目标目录。
    pub fn create(path: &Path) -> Result<Self> {
        ensure_initialized()?;
        let path_c = cstring(&path.to_string_lossy())?;
        let schema = build_schema()?;
        let options = CollectionOptions::new(false)?;
        let mut collection: *mut ffi::zvec_collection_t = ptr::null_mut();
        let code = unsafe {
            ffi::zvec_collection_create_and_open(
                path_c.as_ptr(),
                schema.0,
                options.0,
                &mut collection,
            )
        };
        drop(options);
        drop(schema);
        check(code).with_context(|| format!("创建 zvec collection 失败：{}", path.display()))?;
        if collection.is_null() {
            bail!("zvec_collection_create_and_open 返回空句柄");
        }
        Ok(Self { collection })
    }

    /// 打开已有 collection（读写；索引构建/增量更新用）。
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_inner(path, false)
    }

    /// 只读打开（serve 用；索引可挂载为只读卷，无需写锁文件）。
    pub fn open_read_only(path: &Path) -> Result<Self> {
        Self::open_inner(path, true)
    }

    fn open_inner(path: &Path, read_only: bool) -> Result<Self> {
        ensure_initialized()?;
        let path_c = cstring(&path.to_string_lossy())?;
        let options = CollectionOptions::new(read_only)?;
        let mut collection: *mut ffi::zvec_collection_t = ptr::null_mut();
        let code =
            unsafe { ffi::zvec_collection_open(path_c.as_ptr(), options.0, &mut collection) };
        drop(options);
        check(code).with_context(|| format!("打开 zvec collection 失败：{}", path.display()))?;
        if collection.is_null() {
            bail!("zvec_collection_open 返回空句柄");
        }
        Ok(Self { collection })
    }

    /// 批量写入（insert）。每批 500 条。
    pub fn insert(&self, documents: &[ChunkDocument<'_>]) -> Result<()> {
        self.write_batch(documents, false)
    }

    /// 批量 upsert（增量更新用）。
    #[allow(dead_code)]
    pub fn upsert(&self, documents: &[ChunkDocument<'_>]) -> Result<()> {
        self.write_batch(documents, true)
    }

    fn write_batch(&self, documents: &[ChunkDocument<'_>], upsert: bool) -> Result<()> {
        for batch in documents.chunks(500) {
            self.write_chunk_batch(batch, upsert)?;
        }
        Ok(())
    }

    fn write_chunk_batch(&self, batch: &[ChunkDocument<'_>], upsert: bool) -> Result<()> {
        let mut raw_docs: Vec<*const ffi::zvec_doc_t> = Vec::with_capacity(batch.len());
        // 保证 CString / C 字符串生命周期覆盖 insert 调用。
        let mut keep_alive: Vec<Vec<CString>> = Vec::with_capacity(batch.len());

        for document in batch {
            let strings = [
                document.id.as_str(),
                document.parent_id,
                document.app_id,
                document.title,
                document.tags,
                document.content_hash,
                document.href,
                document.text,
            ]
            .into_iter()
            .map(cstring)
            .collect::<Result<Vec<_>>>()?;

            let doc = unsafe { ffi::zvec_doc_create() };
            if doc.is_null() {
                bail!("zvec_doc_create 返回 NULL");
            }

            unsafe {
                ffi::zvec_doc_set_pk(doc, strings[0].as_ptr());
                add_string(doc, FIELD_PARENT_ID, &strings[1])?;
                add_string(doc, FIELD_APP_ID, &strings[2])?;
                add_string(doc, FIELD_TITLE, &strings[3])?;
                add_string(doc, FIELD_TAGS, &strings[4])?;
                add_string(doc, FIELD_CONTENT_HASH, &strings[5])?;
                add_string(doc, FIELD_HREF, &strings[6])?;
                add_string(doc, FIELD_TEXT, &strings[7])?;
                add_basic(
                    doc,
                    FIELD_DATE,
                    ffi::ZVEC_DATA_TYPE_INT64,
                    &document.date as *const i64 as *const c_void,
                    std::mem::size_of::<i64>(),
                )?;
                add_basic(
                    doc,
                    FIELD_CHUNK_INDEX,
                    ffi::ZVEC_DATA_TYPE_INT32,
                    &document.chunk_index as *const i32 as *const c_void,
                    std::mem::size_of::<i32>(),
                )?;
                add_basic(
                    doc,
                    FIELD_EMBEDDING,
                    ffi::ZVEC_DATA_TYPE_VECTOR_FP32,
                    document.embedding.as_ptr() as *const c_void,
                    std::mem::size_of_val(document.embedding),
                )?;
            }

            raw_docs.push(doc);
            keep_alive.push(strings);
        }

        let mut success = 0usize;
        let mut errors = 0usize;
        let code = unsafe {
            let docs_ptr = raw_docs.as_ptr();
            if upsert {
                ffi::zvec_collection_upsert(
                    self.collection,
                    docs_ptr,
                    raw_docs.len(),
                    &mut success,
                    &mut errors,
                )
            } else {
                ffi::zvec_collection_insert(
                    self.collection,
                    docs_ptr,
                    raw_docs.len(),
                    &mut success,
                    &mut errors,
                )
            }
        };

        for doc in &raw_docs {
            unsafe { ffi::zvec_doc_destroy(*doc as *mut _) };
        }
        drop(keep_alive);

        check(code)?;
        if errors > 0 {
            bail!("zvec 写入部分失败：成功 {success}，失败 {errors}");
        }
        Ok(())
    }

    /// 按主键删除。
    #[allow(dead_code)]
    pub fn delete_pks(&self, pks: &[String]) -> Result<usize> {
        if pks.is_empty() {
            return Ok(0);
        }
        let cstrings = pks
            .iter()
            .map(|pk| cstring(pk))
            .collect::<Result<Vec<_>>>()?;
        let pointers = cstrings.iter().map(|pk| pk.as_ptr()).collect::<Vec<_>>();
        let mut success = 0usize;
        let mut errors = 0usize;
        let code = unsafe {
            ffi::zvec_collection_delete(
                self.collection,
                pointers.as_ptr(),
                pointers.len(),
                &mut success,
                &mut errors,
            )
        };
        check(code)?;
        if errors > 0 {
            bail!("zvec 删除部分失败：成功 {success}，失败 {errors}");
        }
        Ok(success)
    }

    /// 按过滤表达式删除（整篇 upsert 前清理旧 chunk 用）。
    #[allow(dead_code)]
    pub fn delete_by_filter(&self, filter: &str) -> Result<()> {
        let filter = cstring(filter)?;
        let code =
            unsafe { ffi::zvec_collection_delete_by_filter(self.collection, filter.as_ptr()) };
        check(code)
    }

    pub fn flush(&self) -> Result<()> {
        check(unsafe { ffi::zvec_collection_flush(self.collection) })
    }

    pub fn optimize(&self) -> Result<()> {
        check(unsafe { ffi::zvec_collection_optimize(self.collection) })
    }

    pub fn doc_count(&self) -> Result<u64> {
        let mut stats: *mut ffi::zvec_collection_stats_t = ptr::null_mut();
        let code = unsafe { ffi::zvec_collection_get_stats(self.collection, &mut stats) };
        check(code)?;
        if stats.is_null() {
            return Ok(0);
        }
        let count = unsafe { ffi::zvec_collection_stats_get_doc_count(stats) };
        unsafe { ffi::zvec_collection_stats_destroy(stats) };
        Ok(count)
    }

    /// 执行检索（vector / fts / hybrid）。
    pub fn search(
        &self,
        mode: SearchMode,
        embedding: Option<&[f32]>,
        query: &str,
        filter: Option<&str>,
        topk: usize,
    ) -> Result<Vec<Hit>> {
        let topk = topk.clamp(1, 1000) as i32;
        let filter_c = filter.map(cstring).transpose()?;
        let filter_ptr = filter_c
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(ptr::null());

        let output_fields = OUTPUT_FIELDS
            .iter()
            .map(|field| cstring(field))
            .collect::<Result<Vec<_>>>()?;
        let output_ptrs = field_ptrs(&output_fields);

        let mut results: *mut *mut ffi::zvec_doc_t = ptr::null_mut();
        let mut count = 0usize;

        let code = unsafe {
            match mode {
                SearchMode::Hybrid => {
                    let embedding = embedding.context("hybrid 检索缺少 query embedding")?;
                    let multi = ffi::zvec_multi_query_create();
                    if multi.is_null() {
                        bail!("zvec_multi_query_create 返回 NULL");
                    }
                    let outcome = (|| -> Result<()> {
                        check(ffi::zvec_multi_query_set_topk(multi, topk))?;
                        if !filter_ptr.is_null() {
                            check(ffi::zvec_multi_query_set_filter(multi, filter_ptr))?;
                        }
                        check(ffi::zvec_multi_query_set_include_vector(multi, false))?;
                        check(ffi::zvec_multi_query_set_output_fields(
                            multi,
                            output_ptrs.as_ptr(),
                            output_ptrs.len(),
                        ))?;
                        check(ffi::zvec_multi_query_set_rerank_rrf(multi, 60))?;

                        let vector_sub = build_vector_sub_query(embedding, topk)?;
                        let fts_sub = build_fts_sub_query(query, topk)?;
                        check(ffi::zvec_multi_query_add_sub_query(multi, vector_sub.0))?;
                        check(ffi::zvec_multi_query_add_sub_query(multi, fts_sub.0))?;
                        drop(vector_sub);
                        drop(fts_sub);

                        check(ffi::zvec_collection_multi_query(
                            self.collection,
                            multi,
                            &mut results,
                            &mut count,
                        ))
                    })();
                    ffi::zvec_multi_query_destroy(multi);
                    outcome?;
                    ffi::ZVEC_OK
                }
                SearchMode::Vector => {
                    let embedding = embedding.context("vector 检索缺少 query embedding")?;
                    let query_handle = ffi::zvec_vector_query_create();
                    if query_handle.is_null() {
                        bail!("zvec_vector_query_create 返回 NULL");
                    }
                    let outcome = (|| -> Result<()> {
                        let field = cstring(FIELD_EMBEDDING)?;
                        check(ffi::zvec_vector_query_set_field_name(
                            query_handle,
                            field.as_ptr(),
                        ))?;
                        check(ffi::zvec_vector_query_set_query_vector(
                            query_handle,
                            embedding.as_ptr() as *const c_void,
                            std::mem::size_of_val(embedding),
                        ))?;
                        check(ffi::zvec_vector_query_set_topk(query_handle, topk))?;
                        if !filter_ptr.is_null() {
                            check(ffi::zvec_vector_query_set_filter(query_handle, filter_ptr))?;
                        }
                        check(ffi::zvec_vector_query_set_include_vector(
                            query_handle,
                            false,
                        ))?;
                        check(ffi::zvec_vector_query_set_include_doc_id(
                            query_handle,
                            true,
                        ))?;
                        check(ffi::zvec_vector_query_set_output_fields(
                            query_handle,
                            output_ptrs.as_ptr(),
                            output_ptrs.len(),
                        ))?;
                        let hnsw = ffi::zvec_query_params_hnsw_create();
                        if hnsw.is_null() {
                            bail!("zvec_query_params_hnsw_create 返回 NULL");
                        }
                        if let Err(error) = check(ffi::zvec_query_params_hnsw_set_ef(hnsw, 100)) {
                            ffi::zvec_query_params_hnsw_destroy(hnsw);
                            return Err(error);
                        }
                        // set_hnsw_params 转移所有权，成功后不能 destroy。
                        check(ffi::zvec_vector_query_set_hnsw_params(query_handle, hnsw))?;
                        check(ffi::zvec_collection_query(
                            self.collection,
                            query_handle,
                            &mut results,
                            &mut count,
                        ))
                    })();
                    ffi::zvec_vector_query_destroy(query_handle);
                    outcome?;
                    ffi::ZVEC_OK
                }
                SearchMode::Fts => {
                    let query_handle = ffi::zvec_vector_query_create();
                    if query_handle.is_null() {
                        bail!("zvec_vector_query_create 返回 NULL");
                    }
                    let outcome = (|| -> Result<()> {
                        let field = cstring(FIELD_TEXT)?;
                        check(ffi::zvec_vector_query_set_field_name(
                            query_handle,
                            field.as_ptr(),
                        ))?;
                        check(ffi::zvec_vector_query_set_topk(query_handle, topk))?;
                        if !filter_ptr.is_null() {
                            check(ffi::zvec_vector_query_set_filter(query_handle, filter_ptr))?;
                        }
                        check(ffi::zvec_vector_query_set_include_vector(
                            query_handle,
                            false,
                        ))?;
                        check(ffi::zvec_vector_query_set_output_fields(
                            query_handle,
                            output_ptrs.as_ptr(),
                            output_ptrs.len(),
                        ))?;
                        let fts = build_fts_payload(query)?;
                        check(ffi::zvec_vector_query_set_fts(query_handle, fts.0))?;
                        drop(fts);
                        let fts_params = ffi::zvec_query_params_fts_create(cstr(b"OR")?.as_ptr());
                        if fts_params.is_null() {
                            bail!("zvec_query_params_fts_create 返回 NULL");
                        }
                        check(ffi::zvec_vector_query_set_fts_params(
                            query_handle,
                            fts_params,
                        ))?;
                        check(ffi::zvec_collection_query(
                            self.collection,
                            query_handle,
                            &mut results,
                            &mut count,
                        ))
                    })();
                    ffi::zvec_vector_query_destroy(query_handle);
                    outcome?;
                    ffi::ZVEC_OK
                }
            }
        };

        check(code)?;
        if results.is_null() || count == 0 {
            return Ok(Vec::new());
        }

        let mut hits = Vec::with_capacity(count);
        for index in 0..count {
            let doc = unsafe { *results.add(index) };
            if doc.is_null() {
                continue;
            }
            let hit = unsafe { hit_from_doc(doc) };
            if let Some(hit) = hit {
                hits.push(hit);
            }
        }
        unsafe { ffi::zvec_docs_free(results, count) };
        Ok(hits)
    }
}

impl Drop for ZvecStore {
    fn drop(&mut self) {
        if !self.collection.is_null() {
            unsafe {
                // 注意：不能用 zvec_collection_destroy——它调用 Collection::destroy()
                // 删除磁盘数据；close 只释放句柄。数据已显式 flush。
                let _ = ffi::zvec_collection_close(self.collection);
            }
            self.collection = ptr::null_mut();
        }
    }
}

struct CollectionOptions(*mut ffi::zvec_collection_options_t);

impl CollectionOptions {
    fn new(read_only: bool) -> Result<Self> {
        let options = unsafe { ffi::zvec_collection_options_create() };
        if options.is_null() {
            bail!("zvec_collection_options_create 返回 NULL");
        }
        let options = Self(options);
        check(unsafe { ffi::zvec_collection_options_set_enable_mmap(options.0, true) })?;
        if read_only {
            check(unsafe { ffi::zvec_collection_options_set_read_only(options.0, true) })?;
        }
        Ok(options)
    }
}

impl Drop for CollectionOptions {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ffi::zvec_collection_options_destroy(self.0) };
        }
    }
}

struct Schema(*mut ffi::zvec_collection_schema_t);

impl Drop for Schema {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ffi::zvec_collection_schema_destroy(self.0) };
        }
    }
}

fn build_schema() -> Result<Schema> {
    ensure_initialized()?;
    let schema = unsafe { ffi::zvec_collection_schema_create(cstring(COLLECTION_NAME)?.as_ptr()) };
    if schema.is_null() {
        bail!("zvec_collection_schema_create 返回 NULL");
    }
    let schema = Schema(schema);

    // 标量：parentId/appId 倒排；date 倒排 + range；tags 倒排（LIKE 过滤）。
    add_field(
        schema.0,
        FIELD_PARENT_ID,
        ffi::ZVEC_DATA_TYPE_STRING,
        0,
        Some(IndexSpec::Invert {
            range: false,
            wildcard: false,
        }),
    )?;
    add_field(
        schema.0,
        FIELD_APP_ID,
        ffi::ZVEC_DATA_TYPE_STRING,
        0,
        Some(IndexSpec::Invert {
            range: false,
            wildcard: false,
        }),
    )?;
    add_field(schema.0, FIELD_TITLE, ffi::ZVEC_DATA_TYPE_STRING, 0, None)?;
    add_field(
        schema.0,
        FIELD_TAGS,
        ffi::ZVEC_DATA_TYPE_STRING,
        0,
        Some(IndexSpec::Invert {
            range: false,
            wildcard: true,
        }),
    )?;
    add_field(
        schema.0,
        FIELD_DATE,
        ffi::ZVEC_DATA_TYPE_INT64,
        0,
        Some(IndexSpec::Invert {
            range: true,
            wildcard: false,
        }),
    )?;
    add_field(
        schema.0,
        FIELD_CHUNK_INDEX,
        ffi::ZVEC_DATA_TYPE_INT32,
        0,
        None,
    )?;
    add_field(
        schema.0,
        FIELD_CONTENT_HASH,
        ffi::ZVEC_DATA_TYPE_STRING,
        0,
        None,
    )?;
    add_field(schema.0, FIELD_HREF, ffi::ZVEC_DATA_TYPE_STRING, 0, None)?;

    // FTS：jieba（中英混排），默认 OR 由查询参数控制。
    let fts_params = unsafe { ffi::zvec_index_params_create(ffi::ZVEC_INDEX_TYPE_FTS) };
    if fts_params.is_null() {
        bail!("zvec_index_params_create(FTS) 返回 NULL");
    }
    let tokenizer = cstring("jieba")?;
    let fts_code = unsafe {
        ffi::zvec_index_params_set_fts_params(
            fts_params,
            tokenizer.as_ptr(),
            ptr::null(),
            ptr::null(),
        )
    };
    let fts_result = check(fts_code);
    if let Err(error) = fts_result {
        unsafe { ffi::zvec_index_params_destroy(fts_params) };
        return Err(error);
    }
    let field_result = add_field_with_params(
        schema.0,
        FIELD_TEXT,
        ffi::ZVEC_DATA_TYPE_STRING,
        0,
        fts_params,
    );
    unsafe { ffi::zvec_index_params_destroy(fts_params) };
    field_result?;

    // dense：HNSW + COSINE。
    let hnsw_params = unsafe { ffi::zvec_index_params_create(ffi::ZVEC_INDEX_TYPE_HNSW) };
    if hnsw_params.is_null() {
        bail!("zvec_index_params_create(HNSW) 返回 NULL");
    }
    let hnsw_result = (|| -> Result<()> {
        check(unsafe {
            ffi::zvec_index_params_set_metric_type(hnsw_params, ffi::ZVEC_METRIC_TYPE_COSINE)
        })?;
        check(unsafe { ffi::zvec_index_params_set_hnsw_params(hnsw_params, 16, 100) })?;
        add_field_with_params(
            schema.0,
            FIELD_EMBEDDING,
            ffi::ZVEC_DATA_TYPE_VECTOR_FP32,
            EMBEDDING_DIM as u32,
            hnsw_params,
        )
    })();
    unsafe { ffi::zvec_index_params_destroy(hnsw_params) };
    hnsw_result?;

    Ok(schema)
}

enum IndexSpec {
    Invert { range: bool, wildcard: bool },
}

fn add_field(
    schema: *mut ffi::zvec_collection_schema_t,
    name: &str,
    data_type: ffi::zvec_data_type_t,
    dimension: u32,
    index: Option<IndexSpec>,
) -> Result<()> {
    match index {
        None => add_field_with_params(schema, name, data_type, dimension, ptr::null_mut()),
        Some(IndexSpec::Invert { range, wildcard }) => {
            let params = unsafe { ffi::zvec_index_params_create(ffi::ZVEC_INDEX_TYPE_INVERT) };
            if params.is_null() {
                bail!("zvec_index_params_create(INVERT) 返回 NULL");
            }
            let result = (|| -> Result<()> {
                check(unsafe {
                    ffi::zvec_index_params_set_invert_params(params, range, wildcard)
                })?;
                add_field_with_params(schema, name, data_type, dimension, params)
            })();
            unsafe { ffi::zvec_index_params_destroy(params) };
            result
        }
    }
}

fn add_field_with_params(
    schema: *mut ffi::zvec_collection_schema_t,
    name: &str,
    data_type: ffi::zvec_data_type_t,
    dimension: u32,
    index_params: *mut ffi::zvec_index_params_t,
) -> Result<()> {
    let name_c = cstring(name)?;
    let field =
        unsafe { ffi::zvec_field_schema_create(name_c.as_ptr(), data_type, false, dimension) };
    if field.is_null() {
        bail!("zvec_field_schema_create({name}) 返回 NULL");
    }
    let result = (|| -> Result<()> {
        if !index_params.is_null() {
            check(unsafe { ffi::zvec_field_schema_set_index_params(field, index_params) })?;
        }
        check(unsafe { ffi::zvec_collection_schema_add_field(schema, field) })
            .with_context(|| format!("添加字段 {name} 失败"))
    })();
    unsafe { ffi::zvec_field_schema_destroy(field) };
    result
}

struct VectorSubQuery(*mut ffi::zvec_sub_query_t);

impl Drop for VectorSubQuery {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ffi::zvec_sub_query_destroy(self.0) };
        }
    }
}

struct FtsSubQuery(*mut ffi::zvec_sub_query_t);

impl Drop for FtsSubQuery {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ffi::zvec_sub_query_destroy(self.0) };
        }
    }
}

fn build_vector_sub_query(embedding: &[f32], topk: i32) -> Result<VectorSubQuery> {
    let sub = unsafe { ffi::zvec_sub_query_create() };
    if sub.is_null() {
        bail!("zvec_sub_query_create 返回 NULL");
    }
    let sub = VectorSubQuery(sub);
    let field = cstring(FIELD_EMBEDDING)?;
    check(unsafe { ffi::zvec_sub_query_set_field_name(sub.0, field.as_ptr()) })?;
    check(unsafe {
        ffi::zvec_sub_query_set_query_vector(
            sub.0,
            embedding.as_ptr() as *const c_void,
            std::mem::size_of_val(embedding),
        )
    })?;
    check(unsafe { ffi::zvec_sub_query_set_num_candidates(sub.0, topk) })?;
    let hnsw = unsafe { ffi::zvec_query_params_hnsw_create() };
    if hnsw.is_null() {
        bail!("zvec_query_params_hnsw_create 返回 NULL");
    }
    if let Err(error) = check(unsafe { ffi::zvec_query_params_hnsw_set_ef(hnsw, 100) }) {
        unsafe { ffi::zvec_query_params_hnsw_destroy(hnsw) };
        return Err(error);
    }
    // 所有权转移给 sub-query。
    check(unsafe { ffi::zvec_sub_query_set_hnsw_params(sub.0, hnsw) })?;
    Ok(sub)
}

fn build_fts_sub_query(query: &str, topk: i32) -> Result<FtsSubQuery> {
    let sub = unsafe { ffi::zvec_sub_query_create() };
    if sub.is_null() {
        bail!("zvec_sub_query_create 返回 NULL");
    }
    let sub = FtsSubQuery(sub);
    let field = cstring(FIELD_TEXT)?;
    check(unsafe { ffi::zvec_sub_query_set_field_name(sub.0, field.as_ptr()) })?;
    check(unsafe { ffi::zvec_sub_query_set_num_candidates(sub.0, topk) })?;
    let fts = build_fts_payload(query)?;
    check(unsafe { ffi::zvec_sub_query_set_fts(sub.0, fts.0) })?;
    drop(fts);
    let params = unsafe { ffi::zvec_query_params_fts_create(cstr(b"OR")?.as_ptr()) };
    if params.is_null() {
        bail!("zvec_query_params_fts_create 返回 NULL");
    }
    // 所有权转移给 sub-query。
    check(unsafe { ffi::zvec_sub_query_set_fts_params(sub.0, params) })?;
    Ok(sub)
}

struct Fts(*mut ffi::zvec_fts_t);

impl Drop for Fts {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ffi::zvec_fts_destroy(self.0) };
        }
    }
}

fn build_fts_payload(query: &str) -> Result<Fts> {
    let fts = unsafe { ffi::zvec_fts_create() };
    if fts.is_null() {
        bail!("zvec_fts_create 返回 NULL");
    }
    let fts = Fts(fts);
    let query = cstring(query)?;
    check(unsafe { ffi::zvec_fts_set_match_string(fts.0, query.as_ptr()) })?;
    Ok(fts)
}

fn cstr(value: &[u8]) -> Result<std::ffi::CString> {
    std::ffi::CString::new(value).map_err(|_| anyhow::anyhow!("C 字符串包含 NUL"))
}

unsafe fn add_string(doc: *mut ffi::zvec_doc_t, field: &str, value: &CString) -> Result<()> {
    add_basic(
        doc,
        field,
        ffi::ZVEC_DATA_TYPE_STRING,
        value.as_ptr() as *const c_void,
        value.as_bytes().len(),
    )
}

unsafe fn add_basic(
    doc: *mut ffi::zvec_doc_t,
    field: &str,
    data_type: ffi::zvec_data_type_t,
    value: *const c_void,
    size: usize,
) -> Result<()> {
    let field_c = cstring(field)?;
    check(ffi::zvec_doc_add_field_by_value(
        doc,
        field_c.as_ptr(),
        data_type,
        value,
        size,
    ))
}

unsafe fn hit_from_doc(doc: *const ffi::zvec_doc_t) -> Option<Hit> {
    let parent_id = field_string(doc, FIELD_PARENT_ID)?;
    let app_id = field_string(doc, FIELD_APP_ID)?;
    let title = field_string(doc, FIELD_TITLE).unwrap_or_default();
    let href = field_string(doc, FIELD_HREF).unwrap_or_default();
    let text = field_string(doc, FIELD_TEXT).unwrap_or_default();
    let date = field_i64(doc, FIELD_DATE).unwrap_or(0);
    let chunk_index = field_i32(doc, FIELD_CHUNK_INDEX).unwrap_or(0);
    Some(Hit {
        parent_id,
        app_id,
        title,
        date,
        chunk_index,
        href,
        text,
        score: ffi::zvec_doc_get_score(doc),
    })
}

unsafe fn field_string(doc: *const ffi::zvec_doc_t, field: &str) -> Option<String> {
    let field_c = cstring(field).ok()?;
    let mut value: *const c_void = ptr::null();
    let mut size = 0usize;
    let code = ffi::zvec_doc_get_field_value_pointer(
        doc,
        field_c.as_ptr(),
        ffi::ZVEC_DATA_TYPE_STRING,
        &mut value,
        &mut size,
    );
    if code != ffi::ZVEC_OK || value.is_null() {
        return None;
    }
    let text = CStr::from_ptr(value as *const std::os::raw::c_char)
        .to_string_lossy()
        .into_owned();
    Some(text)
}

unsafe fn field_i64(doc: *const ffi::zvec_doc_t, field: &str) -> Option<i64> {
    let field_c = cstring(field).ok()?;
    let mut value: i64 = 0;
    let code = ffi::zvec_doc_get_field_value_basic(
        doc,
        field_c.as_ptr(),
        ffi::ZVEC_DATA_TYPE_INT64,
        &mut value as *mut i64 as *mut c_void,
        std::mem::size_of::<i64>(),
    );
    (code == ffi::ZVEC_OK).then_some(value)
}

unsafe fn field_i32(doc: *const ffi::zvec_doc_t, field: &str) -> Option<i32> {
    let field_c = cstring(field).ok()?;
    let mut value: i32 = 0;
    let code = ffi::zvec_doc_get_field_value_basic(
        doc,
        field_c.as_ptr(),
        ffi::ZVEC_DATA_TYPE_INT32,
        &mut value as *mut i32 as *mut c_void,
        std::mem::size_of::<i32>(),
    );
    (code == ffi::ZVEC_OK).then_some(value)
}

/// 校验 embedding 维度，写入/查询前调用。
#[allow(dead_code)]
pub fn validate_embedding(embedding: &[f32]) -> Result<()> {
    if embedding.len() != EMBEDDING_DIM {
        bail!(
            "embedding 维度错误：期望 {}，实际 {}",
            EMBEDDING_DIM,
            embedding.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedding(seed: usize, primary: usize) -> Vec<f32> {
        let mut vector = vec![0.0f32; EMBEDDING_DIM];
        vector[primary % EMBEDDING_DIM] = 1.0;
        vector[(seed + 7) % EMBEDDING_DIM] = 0.05;
        crate::embed::l2_normalize(&mut vector);
        vector
    }

    #[test]
    fn zvec_roundtrip_vector_fts_hybrid_and_filter() {
        let directory = tempfile::tempdir().expect("临时目录");
        let collection = directory.path().join("collection");
        let store = ZvecStore::create(&collection).expect("创建 collection");

        let vector_a = embedding(1, 0);
        let vector_b = embedding(2, 1);
        let text_a = "rust async runtime tokio concurrency";
        let text_b = "vector database hnsw semantic search";
        let docs = [
            ChunkDocument {
                id: "a#0".to_string(),
                parent_id: "parent-a",
                app_id: "event",
                title: "Rust 异步运行时",
                tags: " rust ",
                date: 1_700_000_000_000,
                chunk_index: 0,
                content_hash: "hash-a",
                href: "/article/events/a",
                text: text_a,
                embedding: &vector_a,
            },
            ChunkDocument {
                id: "b#0".to_string(),
                parent_id: "parent-b",
                app_id: "articles",
                title: "向量数据库",
                tags: " database ",
                date: 1_600_000_000_000,
                chunk_index: 0,
                content_hash: "hash-b",
                href: "/article/articles/b",
                text: text_b,
                embedding: &vector_b,
            },
        ];
        store.insert(&docs).expect("写入");
        store.optimize().expect("optimize");
        store.flush().expect("flush");
        assert_eq!(store.doc_count().expect("统计"), 2);

        let hits = store
            .search(SearchMode::Vector, Some(&vector_a), "unused", None, 5)
            .expect("向量检索");
        assert!(!hits.is_empty());
        assert_eq!(hits[0].parent_id, "parent-a");
        assert!(
            hits[0].score < 0.01,
            "COSINE 距离应接近 0：{}",
            hits[0].score
        );
        assert_eq!(hits[0].title, "Rust 异步运行时");
        assert_eq!(hits[0].href, "/article/events/a");

        let hits = store
            .search(SearchMode::Fts, None, "rust", None, 5)
            .expect("FTS 检索");
        assert!(!hits.is_empty());
        assert_eq!(hits[0].parent_id, "parent-a");

        let hits = store
            .search(SearchMode::Hybrid, Some(&vector_b), "hnsw", None, 5)
            .expect("混合检索");
        assert!(!hits.is_empty());
        assert_eq!(hits[0].parent_id, "parent-b");
        assert!(hits[0].score > 0.0);

        let hits = store
            .search(
                SearchMode::Vector,
                Some(&vector_a),
                "unused",
                Some("appId = 'articles'"),
                5,
            )
            .expect("过滤检索");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].parent_id, "parent-b");

        let hits = store
            .search(
                SearchMode::Vector,
                Some(&vector_a),
                "unused",
                Some("tags LIKE '% rust %'"),
                5,
            )
            .expect("标签过滤");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].parent_id, "parent-a");

        store
            .delete_by_filter("appId = 'articles'")
            .expect("按过滤删除");
        store.flush().expect("flush");
        assert_eq!(store.doc_count().expect("统计"), 1);

        // close（而非 destroy）后数据必须仍在磁盘，可重新打开。
        drop(store);
        let reopened = ZvecStore::open(&collection).expect("重新打开 collection");
        assert_eq!(reopened.doc_count().expect("重开统计"), 1);
        drop(reopened);

        // serve 使用的只读打开（索引可挂载为只读卷）。
        let read_only = ZvecStore::open_read_only(&collection).expect("只读打开 collection");
        assert_eq!(read_only.doc_count().expect("只读统计"), 1);
        let hits = read_only
            .search(
                SearchMode::Vector,
                Some(&embedding(1, 0)),
                "unused",
                None,
                5,
            )
            .expect("只读检索");
        assert_eq!(hits[0].parent_id, "parent-a");
    }
}
