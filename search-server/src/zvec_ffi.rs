//! alibaba/zvec 0.8.1 官方 C SDK 的最小 FFI 绑定。
//!
//! 官方发布物只有 C API（`libzvec_c_api` + `include/zvec/c_api.h`），没有官方
//! Rust crate；crates.io 的 `zvec` 0.1.0 是第三方早期绑定（SDK 0.3 时代）。
//! 这里按 0.8.1 头文件声明最小子集，所有句柄都是不透明指针，避免绑定结构体布局。
#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};

pub type zvec_error_code_t = u32;
pub type zvec_data_type_t = u32;
pub type zvec_index_type_t = u32;
pub type zvec_metric_type_t = u32;

pub const ZVEC_OK: zvec_error_code_t = 0;

pub const ZVEC_DATA_TYPE_STRING: zvec_data_type_t = 2;
pub const ZVEC_DATA_TYPE_INT32: zvec_data_type_t = 4;
pub const ZVEC_DATA_TYPE_INT64: zvec_data_type_t = 5;
pub const ZVEC_DATA_TYPE_VECTOR_FP32: zvec_data_type_t = 23;

pub const ZVEC_INDEX_TYPE_HNSW: zvec_index_type_t = 1;
pub const ZVEC_INDEX_TYPE_FLAT: zvec_index_type_t = 3;
pub const ZVEC_INDEX_TYPE_INVERT: zvec_index_type_t = 10;
pub const ZVEC_INDEX_TYPE_FTS: zvec_index_type_t = 11;

pub const ZVEC_METRIC_TYPE_COSINE: zvec_metric_type_t = 3;

#[repr(C)]
pub struct zvec_config_data_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_collection_schema_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_field_schema_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_index_params_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_collection_options_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_collection_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_collection_stats_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_doc_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_vector_query_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_multi_query_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_sub_query_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_hnsw_query_params_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_flat_query_params_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_fts_query_params_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_fts_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_string_t {
    _private: [u8; 0],
}
#[repr(C)]
pub struct zvec_string_array_t {
    _private: [u8; 0],
}

extern "C" {
    pub fn zvec_get_version() -> *const c_char;
    pub fn zvec_get_last_error(error_msg: *mut *mut c_char) -> zvec_error_code_t;
    pub fn zvec_free(ptr: *mut c_void);

    pub fn zvec_initialize(config: *const zvec_config_data_t) -> zvec_error_code_t;
    pub fn zvec_config_data_create() -> *mut zvec_config_data_t;
    pub fn zvec_config_data_destroy(config: *mut zvec_config_data_t);
    pub fn zvec_config_data_set_memory_limit(
        config: *mut zvec_config_data_t,
        memory_limit_bytes: u64,
    ) -> zvec_error_code_t;
    pub fn zvec_config_data_set_query_thread_count(
        config: *mut zvec_config_data_t,
        thread_count: u32,
    ) -> zvec_error_code_t;

    pub fn zvec_collection_schema_create(name: *const c_char) -> *mut zvec_collection_schema_t;
    pub fn zvec_collection_schema_destroy(schema: *mut zvec_collection_schema_t);
    pub fn zvec_collection_schema_add_field(
        schema: *mut zvec_collection_schema_t,
        field: *const zvec_field_schema_t,
    ) -> zvec_error_code_t;

    pub fn zvec_field_schema_create(
        name: *const c_char,
        data_type: zvec_data_type_t,
        nullable: bool,
        dimension: u32,
    ) -> *mut zvec_field_schema_t;
    pub fn zvec_field_schema_destroy(schema: *mut zvec_field_schema_t);
    pub fn zvec_field_schema_set_index_params(
        schema: *mut zvec_field_schema_t,
        index_params: *const zvec_index_params_t,
    ) -> zvec_error_code_t;

    pub fn zvec_index_params_create(index_type: zvec_index_type_t) -> *mut zvec_index_params_t;
    pub fn zvec_index_params_destroy(params: *mut zvec_index_params_t);
    pub fn zvec_index_params_set_metric_type(
        params: *mut zvec_index_params_t,
        metric_type: zvec_metric_type_t,
    ) -> zvec_error_code_t;
    pub fn zvec_index_params_set_hnsw_params(
        params: *mut zvec_index_params_t,
        m: i32,
        ef_construction: i32,
    ) -> zvec_error_code_t;
    pub fn zvec_index_params_set_invert_params(
        params: *mut zvec_index_params_t,
        enable_range_opt: bool,
        enable_wildcard: bool,
    ) -> zvec_error_code_t;
    pub fn zvec_index_params_set_fts_params(
        params: *mut zvec_index_params_t,
        tokenizer_name: *const c_char,
        filters: *const zvec_string_array_t,
        extra_params: *const c_char,
    ) -> zvec_error_code_t;

    pub fn zvec_collection_options_create() -> *mut zvec_collection_options_t;
    pub fn zvec_collection_options_destroy(options: *mut zvec_collection_options_t);
    pub fn zvec_collection_options_set_enable_mmap(
        options: *mut zvec_collection_options_t,
        enable_mmap: bool,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_options_set_read_only(
        options: *mut zvec_collection_options_t,
        read_only: bool,
    ) -> zvec_error_code_t;

    pub fn zvec_collection_create_and_open(
        path: *const c_char,
        schema: *const zvec_collection_schema_t,
        options: *const zvec_collection_options_t,
        collection: *mut *mut zvec_collection_t,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_open(
        path: *const c_char,
        options: *const zvec_collection_options_t,
        collection: *mut *mut zvec_collection_t,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_close(collection: *mut zvec_collection_t) -> zvec_error_code_t;
    pub fn zvec_collection_destroy(collection: *mut zvec_collection_t) -> zvec_error_code_t;
    pub fn zvec_collection_flush(collection: *mut zvec_collection_t) -> zvec_error_code_t;
    pub fn zvec_collection_optimize(collection: *mut zvec_collection_t) -> zvec_error_code_t;
    pub fn zvec_collection_get_stats(
        collection: *mut zvec_collection_t,
        stats: *mut *mut zvec_collection_stats_t,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_stats_get_doc_count(stats: *const zvec_collection_stats_t) -> u64;
    pub fn zvec_collection_stats_destroy(stats: *mut zvec_collection_stats_t);

    pub fn zvec_doc_create() -> *mut zvec_doc_t;
    pub fn zvec_doc_destroy(doc: *mut zvec_doc_t);
    pub fn zvec_doc_set_pk(doc: *mut zvec_doc_t, pk: *const c_char);
    pub fn zvec_doc_add_field_by_value(
        doc: *mut zvec_doc_t,
        field_name: *const c_char,
        data_type: zvec_data_type_t,
        value: *const c_void,
        value_size: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_doc_get_field_value_basic(
        doc: *const zvec_doc_t,
        field_name: *const c_char,
        field_type: zvec_data_type_t,
        value_buffer: *mut c_void,
        buffer_size: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_doc_get_field_value_pointer(
        doc: *const zvec_doc_t,
        field_name: *const c_char,
        field_type: zvec_data_type_t,
        value: *mut *const c_void,
        value_size: *mut usize,
    ) -> zvec_error_code_t;
    pub fn zvec_doc_get_score(doc: *const zvec_doc_t) -> f32;

    pub fn zvec_collection_insert(
        collection: *mut zvec_collection_t,
        docs: *const *const zvec_doc_t,
        doc_count: usize,
        success_count: *mut usize,
        error_count: *mut usize,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_upsert(
        collection: *mut zvec_collection_t,
        docs: *const *const zvec_doc_t,
        doc_count: usize,
        success_count: *mut usize,
        error_count: *mut usize,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_delete(
        collection: *mut zvec_collection_t,
        pks: *const *const c_char,
        pk_count: usize,
        success_count: *mut usize,
        error_count: *mut usize,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_delete_by_filter(
        collection: *mut zvec_collection_t,
        filter: *const c_char,
    ) -> zvec_error_code_t;
    pub fn zvec_docs_free(documents: *mut *mut zvec_doc_t, count: usize);

    pub fn zvec_vector_query_create() -> *mut zvec_vector_query_t;
    pub fn zvec_vector_query_destroy(query: *mut zvec_vector_query_t);
    pub fn zvec_vector_query_set_field_name(
        query: *mut zvec_vector_query_t,
        field_name: *const c_char,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_query_vector(
        query: *mut zvec_vector_query_t,
        data: *const c_void,
        size: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_topk(
        query: *mut zvec_vector_query_t,
        topk: i32,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_filter(
        query: *mut zvec_vector_query_t,
        filter: *const c_char,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_include_vector(
        query: *mut zvec_vector_query_t,
        include: bool,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_include_doc_id(
        query: *mut zvec_vector_query_t,
        include: bool,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_output_fields(
        query: *mut zvec_vector_query_t,
        fields: *const *const c_char,
        count: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_hnsw_params(
        query: *mut zvec_vector_query_t,
        params: *mut zvec_hnsw_query_params_t,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_fts(
        query: *mut zvec_vector_query_t,
        fts: *const zvec_fts_t,
    ) -> zvec_error_code_t;
    pub fn zvec_vector_query_set_fts_params(
        query: *mut zvec_vector_query_t,
        params: *mut zvec_fts_query_params_t,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_query(
        collection: *const zvec_collection_t,
        query: *const zvec_vector_query_t,
        results: *mut *mut *mut zvec_doc_t,
        result_count: *mut usize,
    ) -> zvec_error_code_t;

    pub fn zvec_query_params_hnsw_create() -> *mut zvec_hnsw_query_params_t;
    pub fn zvec_query_params_hnsw_destroy(params: *mut zvec_hnsw_query_params_t);
    pub fn zvec_query_params_hnsw_set_ef(
        params: *mut zvec_hnsw_query_params_t,
        ef: i32,
    ) -> zvec_error_code_t;
    pub fn zvec_query_params_flat_create(
        is_using_refiner: bool,
        scale_factor: f32,
    ) -> *mut zvec_flat_query_params_t;
    pub fn zvec_query_params_flat_destroy(params: *mut zvec_flat_query_params_t);
    pub fn zvec_vector_query_set_query_params(
        query: *mut zvec_vector_query_t,
        params: *mut c_void,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_flat_params(
        query: *mut zvec_sub_query_t,
        params: *mut zvec_flat_query_params_t,
    ) -> zvec_error_code_t;
    pub fn zvec_query_params_fts_create(
        default_operator: *const c_char,
    ) -> *mut zvec_fts_query_params_t;
    pub fn zvec_query_params_fts_destroy(params: *mut zvec_fts_query_params_t);
    pub fn zvec_fts_create() -> *mut zvec_fts_t;
    pub fn zvec_fts_destroy(fts: *mut zvec_fts_t);
    pub fn zvec_fts_set_match_string(
        fts: *mut zvec_fts_t,
        match_string: *const c_char,
    ) -> zvec_error_code_t;

    pub fn zvec_multi_query_create() -> *mut zvec_multi_query_t;
    pub fn zvec_multi_query_destroy(query: *mut zvec_multi_query_t);
    pub fn zvec_multi_query_add_sub_query(
        query: *mut zvec_multi_query_t,
        sub_query: *const zvec_sub_query_t,
    ) -> zvec_error_code_t;
    pub fn zvec_multi_query_set_topk(
        query: *mut zvec_multi_query_t,
        topk: i32,
    ) -> zvec_error_code_t;
    pub fn zvec_multi_query_set_filter(
        query: *mut zvec_multi_query_t,
        filter: *const c_char,
    ) -> zvec_error_code_t;
    pub fn zvec_multi_query_set_include_vector(
        query: *mut zvec_multi_query_t,
        include: bool,
    ) -> zvec_error_code_t;
    pub fn zvec_multi_query_set_output_fields(
        query: *mut zvec_multi_query_t,
        fields: *const *const c_char,
        count: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_multi_query_set_rerank_rrf(
        query: *mut zvec_multi_query_t,
        rank_constant: i32,
    ) -> zvec_error_code_t;

    pub fn zvec_sub_query_create() -> *mut zvec_sub_query_t;
    pub fn zvec_sub_query_destroy(query: *mut zvec_sub_query_t);
    pub fn zvec_sub_query_set_num_candidates(
        query: *mut zvec_sub_query_t,
        num_candidates: i32,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_field_name(
        query: *mut zvec_sub_query_t,
        field_name: *const c_char,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_query_vector(
        query: *mut zvec_sub_query_t,
        data: *const c_void,
        size: usize,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_hnsw_params(
        query: *mut zvec_sub_query_t,
        hnsw_params: *mut zvec_hnsw_query_params_t,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_fts(
        query: *mut zvec_sub_query_t,
        fts: *const zvec_fts_t,
    ) -> zvec_error_code_t;
    pub fn zvec_sub_query_set_fts_params(
        query: *mut zvec_sub_query_t,
        fts_params: *mut zvec_fts_query_params_t,
    ) -> zvec_error_code_t;
    pub fn zvec_collection_multi_query(
        collection: *const zvec_collection_t,
        query: *const zvec_multi_query_t,
        results: *mut *mut *mut zvec_doc_t,
        result_count: *mut usize,
    ) -> zvec_error_code_t;
}

/// 取走 C SDK 线程内的最近错误文本。
pub fn take_last_error() -> String {
    unsafe {
        let mut message: *mut c_char = std::ptr::null_mut();
        let code = zvec_get_last_error(&mut message);
        if code != ZVEC_OK || message.is_null() {
            return String::from("zvec 未返回错误详情");
        }
        let text = CStr::from_ptr(message).to_string_lossy().into_owned();
        zvec_free(message.cast());
        text
    }
}

/// 把 Rust 字符串转成一次性 CString，失败时给出稳定错误。
pub fn cstring(value: &str) -> anyhow::Result<CString> {
    CString::new(value).map_err(|_| anyhow::anyhow!("字符串包含 NUL 字节：{value:?}"))
}

/// 构造 `const char **` 输出字段数组，调用方保证生命周期覆盖 C 调用。
pub fn field_ptrs(fields: &[CString]) -> Vec<*const c_char> {
    fields.iter().map(|field| field.as_ptr()).collect()
}
