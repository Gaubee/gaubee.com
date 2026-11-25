//! E5-small ONNX 向量化（384 维，mean pooling + L2 归一化）。
//!
//! 取舍：使用 `ort`（ONNX Runtime 官方 C API 的 Rust 绑定，rc.15 自动下载
//! 平台预编译运行库）。相比 candle：ORT 在 CPU 上对 BERT 类模型更快且成熟，
//! 代价是引入原生动态库（Docker 运行时需复制 libonnxruntime）。
use std::path::Path;
use std::sync::Mutex;

use anyhow::{bail, Context, Result};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::chunk::{passage_text, query_text};
use crate::store::EMBEDDING_DIM;

pub const MAX_SEQUENCE_LENGTH: usize = 512;

pub struct Embedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    pad_id: u32,
    batch_size: usize,
    /// 必须最后声明：Rust 按字段顺序 drop，session 先于 environment 释放。
    _environment: ort::environment::Environment,
}

impl Embedder {
    pub fn load(model_path: &Path, tokenizer_path: &Path, threads: usize) -> Result<Self> {
        let environment = ort::init()
            .with_name("gaubee-search")
            .build()
            .map_err(|error| anyhow::anyhow!("初始化 ONNX Runtime 环境失败：{error}"))?;

        let mut tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|error| anyhow::anyhow!("加载 tokenizer 失败：{error}"))?;
        tokenizer
            .with_truncation(Some(tokenizers::TruncationParams {
                max_length: MAX_SEQUENCE_LENGTH,
                ..Default::default()
            }))
            .map_err(|error| anyhow::anyhow!("配置 tokenizer 截断失败：{error}"))?;

        let pad_id = tokenizer.token_to_id("<pad>").unwrap_or(1);
        let session = Session::builder(&environment)
            .map_err(|error| anyhow::anyhow!("创建 ONNX session builder 失败：{error}"))?
            .with_intra_threads(threads.max(1))
            .map_err(|error| anyhow::anyhow!("配置 ONNX 线程数失败：{error}"))?
            .commit_from_file(model_path)
            .map_err(|error| {
                anyhow::anyhow!("加载 ONNX 模型失败（{}）：{error}", model_path.display())
            })?;

        Ok(Self {
            _environment: environment,
            session: Mutex::new(session),
            tokenizer,
            pad_id,
            batch_size: 16,
        })
    }

    /// 文档向量：`passage: ` 前缀。
    pub fn embed_passages(&self, passages: &[String]) -> Result<Vec<Vec<f32>>> {
        let prefixed = passages
            .iter()
            .map(|text| passage_text(text))
            .collect::<Vec<_>>();
        self.embed_batch(&prefixed)
    }

    /// 查询向量：`query: ` 前缀。
    pub fn embed_query(&self, query: &str) -> Result<Vec<f32>> {
        let mut vectors = self.embed_batch(&[query_text(query)])?;
        vectors.pop().context("query embedding 返回空结果")
    }

    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut vectors = Vec::with_capacity(texts.len());
        for batch in texts.chunks(self.batch_size) {
            vectors.extend(self.embed_chunk(batch)?);
        }
        Ok(vectors)
    }

    fn embed_chunk(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|error| anyhow::anyhow!("tokenize 失败：{error}"))?;
        let batch = encodings.len();
        let seq_len = encodings
            .iter()
            .map(|encoding| encoding.get_ids().len())
            .max()
            .unwrap_or(0);
        if seq_len == 0 {
            bail!("embedding 输入为空");
        }

        let mut input_ids = vec![0i64; batch * seq_len];
        let mut attention_mask = vec![0i64; batch * seq_len];
        let token_type_ids = vec![0i64; batch * seq_len];
        let mut masks: Vec<Vec<u8>> = Vec::with_capacity(batch);

        for (row, encoding) in encodings.iter().enumerate() {
            let ids = encoding.get_ids();
            let mask = encoding.get_attention_mask();
            let offset = row * seq_len;
            for (column, id) in ids.iter().enumerate() {
                input_ids[offset + column] = *id as i64;
                attention_mask[offset + column] = mask[column] as i64;
            }
            for column in ids.len()..seq_len {
                input_ids[offset + column] = self.pad_id as i64;
            }
            masks.push(
                attention_mask[offset..offset + seq_len]
                    .iter()
                    .map(|value| *value as u8)
                    .collect(),
            );
        }

        let shape = vec![batch, seq_len];
        let inputs = ort::inputs![
            "input_ids" => Tensor::from_array((shape.clone(), input_ids))?,
            "attention_mask" => Tensor::from_array((shape.clone(), attention_mask))?,
            "token_type_ids" => Tensor::from_array((shape, token_type_ids))?,
        ];

        let mut session = self.session.lock().expect("embedding session 锁中毒");
        let outputs = session.run(inputs).context("ONNX 推理失败")?;
        let (shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .context("提取 ONNX 输出失败")?;
        let dims: &[i64] = shape;
        if dims.len() != 3
            || dims[0] as usize != batch
            || dims[1] as usize != seq_len
            || dims[2] as usize != EMBEDDING_DIM
        {
            bail!("ONNX 输出维度异常：{dims:?}");
        }

        let mut result = Vec::with_capacity(batch);
        for (row, mask) in masks.iter().enumerate() {
            result.push(mean_pool_and_normalize(
                &data[row * seq_len * EMBEDDING_DIM..(row + 1) * seq_len * EMBEDDING_DIM],
                mask,
                EMBEDDING_DIM,
            ));
        }
        Ok(result)
    }
}

/// 对 `[seq_len, dim]` 的 token 向量按 mask 做 mean pooling，再 L2 归一化。
pub fn mean_pool_and_normalize(tokens: &[f32], mask: &[u8], dim: usize) -> Vec<f32> {
    let mut pooled = vec![0.0f32; dim];
    let mut count = 0f32;
    for (index, keep) in mask.iter().enumerate() {
        if *keep == 0 {
            continue;
        }
        let offset = index * dim;
        for column in 0..dim {
            pooled[column] += tokens[offset + column];
        }
        count += 1.0;
    }
    if count > 0.0 {
        for value in &mut pooled {
            *value /= count;
        }
    }
    l2_normalize(&mut pooled);
    pooled
}

pub fn l2_normalize(vector: &mut [f32]) {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for value in vector.iter_mut() {
            *value /= norm;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_pool_ignores_padding_and_normalizes() {
        // 2 个真实 token + 1 个 padding，dim = 2。
        let tokens = [1.0, 1.0, 3.0, 3.0, 9.0, 9.0];
        let mask = [1u8, 1, 0];
        let pooled = mean_pool_and_normalize(&tokens, &mask, 2);
        // mean = (2, 2) → 归一化 = (√0.5, √0.5)。
        assert!((pooled[0] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((pooled[1] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    }

    #[test]
    fn zero_vector_stays_zero() {
        let pooled = mean_pool_and_normalize(&[0.0, 0.0, 0.0, 0.0], &[1, 1], 2);
        assert_eq!(pooled, vec![0.0, 0.0]);
    }

    #[test]
    fn l2_norm_is_one() {
        let mut vector = vec![3.0f32, 4.0];
        l2_normalize(&mut vector);
        assert!((vector[0] - 0.6).abs() < 1e-6);
        assert!((vector[1] - 0.8).abs() < 1e-6);
    }
}
