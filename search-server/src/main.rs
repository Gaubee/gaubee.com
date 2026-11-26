//! gaubee.com 语义搜索服务（SQLite FTS5 + 本地 llama.cpp embedding）。
//!
//! 用法：
//!   cargo run --release -- build     # 全量重建 ./index.sqlite
//!   cargo run --release -- serve     # 监听 127.0.0.1:17082
//!   cargo run --release -- check     # 校验索引是否存在且内容指纹一致
mod api;
mod chunk;
mod content;
mod embed;
mod indexer;
mod manifest;
mod search;
mod store;
#[cfg(test)]
mod test_support;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use crate::api::{router, AppState, ENGINE};
use crate::embed::{
    EmbeddingClient, EmbeddingConfig, PromptProfile, DEFAULT_BASE_URL, DEFAULT_MODEL,
};
use crate::indexer::{build_index, check_index, BuildOptions};
use crate::store::LoadedIndex;

#[derive(Parser)]
#[command(
    name = "search-server",
    version,
    about = "gaubee.com SQLite FTS5 + 远程 embedding 搜索服务"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 全量重建索引。
    Build(BuildArgs),
    /// 启动 HTTP 服务。
    Serve(ServeArgs),
    /// 校验索引是否存在且内容指纹一致（entrypoint 用）。
    Check(CheckArgs),
}

#[derive(Args, Clone)]
struct EmbedArgs {
    /// embedding 服务地址：本地 llama.cpp 或 OpenAI 兼容网关（可带 /v1 或完整 /v1/embeddings）。
    #[arg(long, default_value = DEFAULT_BASE_URL, env = "EMBED_URL")]
    embed_url: String,
    /// 网关 key；本地 loopback 可留空。只从环境变量/命令行注入，不落盘、不打印。
    #[arg(long, env = "EMBED_API_KEY", hide_env_values = true)]
    embed_api_key: Option<String>,
    /// embedding 模型名（请求体里的 model）。
    #[arg(long, default_value = DEFAULT_MODEL, env = "EMBED_MODEL")]
    embed_model: String,
    /// 任务前缀模板：gemma2 / bge-zh / none。必须与建索引时一致。
    #[arg(long, default_value = "gemma2", env = "EMBED_PROMPTS")]
    embed_prompts: String,
}

impl EmbedArgs {
    fn config(
        &self,
        timeout_ms: u64,
        batch_size: usize,
        concurrency: usize,
        retries: u32,
    ) -> Result<EmbeddingConfig> {
        Ok(EmbeddingConfig {
            base_url: self.embed_url.clone(),
            api_key: self.embed_api_key.clone().unwrap_or_default(),
            model: self.embed_model.clone(),
            prompts: PromptProfile::parse(&self.embed_prompts)?,
            timeout: Duration::from_millis(timeout_ms),
            batch_size,
            concurrency,
            max_retries: retries,
        })
    }

    /// 索引一致性校验用的向量空间身份（`模型:前缀模板`）。
    fn identity(&self) -> Result<String> {
        Ok(crate::embed::model_identity(
            &self.embed_model,
            PromptProfile::parse(&self.embed_prompts)?,
        ))
    }
}

#[derive(Args)]
struct BuildArgs {
    /// 内容根目录（含 articles/events 子目录）。
    #[arg(long, default_value = "../src/content", env = "CONTENT_DIR")]
    content: PathBuf,
    /// 索引输出文件。
    #[arg(long, default_value = "./index.sqlite", env = "INDEX_FILE")]
    index: PathBuf,
    #[command(flatten)]
    embed: EmbedArgs,
    /// 每请求 embedding 条数（默认 16：本地 llama-server 单 slot 更稳）。
    #[arg(long, default_value_t = 16, env = "EMBED_BATCH_SIZE")]
    embed_batch_size: usize,
    /// 并发 embedding 请求数（本地单 slot 默认 1，避免排队放大延迟）。
    #[arg(long, default_value_t = 1, env = "EMBED_CONCURRENCY")]
    embed_concurrency: usize,
    /// 构建期单请求超时（毫秒）；本地 2 核建索引单批可达数分钟。
    #[arg(long, default_value_t = 900_000, env = "EMBED_BUILD_TIMEOUT_MS")]
    timeout_ms: u64,
    /// 429/5xx/超时重试次数。
    #[arg(long, default_value_t = 3, env = "EMBED_MAX_RETRIES")]
    max_retries: u32,
    /// 复用旧索引里内容未变的向量（默认开）。用 `--no-incremental` 强制全量。
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set, env = "EMBED_INCREMENTAL")]
    incremental: bool,
}

#[derive(Args)]
struct ServeArgs {
    #[arg(long, default_value = "./index.sqlite", env = "INDEX_FILE")]
    index: PathBuf,
    #[arg(long, default_value = "127.0.0.1:17082", env = "SEARCH_BIND")]
    bind: String,
    #[command(flatten)]
    embed: EmbedArgs,
    /// 查询 embedding 超时（毫秒）；超时自动降级 FTS-only。
    #[arg(long, default_value_t = 3_000, env = "EMBED_TIMEOUT_MS")]
    timeout_ms: u64,
    /// 查询 embedding 重试次数；默认 0，超时立即降级，避免放大客户端超时。
    #[arg(long, default_value_t = 0, env = "EMBED_QUERY_RETRIES")]
    max_retries: u32,
}

#[derive(Args)]
struct CheckArgs {
    #[arg(long, default_value = "../src/content", env = "CONTENT_DIR")]
    content: PathBuf,
    #[arg(long, default_value = "./index.sqlite", env = "INDEX_FILE")]
    index: PathBuf,
    #[command(flatten)]
    embed: EmbedArgs,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    let result = match cli.command {
        Command::Build(args) => run_build(args),
        Command::Check(args) => run_check(args),
        Command::Serve(args) => {
            // 必须在同步上下文构建：reqwest::blocking 客户端内部自带运行时，
            // 在 tokio 上下文里创建/销毁会 panic。
            let embedder = build_embedder(&args);
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("创建 tokio runtime 失败");
            match runtime {
                Ok(runtime) => runtime.block_on(run_serve(args, embedder)),
                Err(error) => Err(error),
            }
        }
    };
    if let Err(error) = result {
        tracing::error!("{error:#}");
        eprintln!("search-server 失败：{error:#}");
        std::process::exit(1);
    }
}

fn run_build(args: BuildArgs) -> Result<()> {
    let embedding = args.embed.config(
        args.timeout_ms,
        args.embed_batch_size,
        args.embed_concurrency,
        args.max_retries,
    )?;
    let report = build_index(&BuildOptions {
        content_root: args.content,
        index_path: args.index.clone(),
        embedding,
        incremental: args.incremental,
    })?;
    println!(
        "索引构建完成：{} 篇文档 / {} chunks（新算 {} / 复用 {}），耗时 {:.1}s，索引 {:.1} MiB",
        report.documents,
        report.chunks,
        report.embedded,
        report.reused,
        report.duration_ms as f64 / 1000.0,
        report.index_bytes as f64 / (1024.0 * 1024.0),
    );
    println!("index:    {}", args.index.display());
    println!(
        "manifest: {}",
        serde_json::to_string(&report.manifest).unwrap_or_default()
    );
    Ok(())
}

fn run_check(args: CheckArgs) -> Result<()> {
    let expected_model = args.embed.identity()?;
    let report = check_index(&args.content, &args.index, &expected_model)?;
    println!("documents:     {}", report.documents);
    println!("contentHash:   {}", report.content_hash);
    println!(
        "indexHash:     {}",
        report.index_content_hash.as_deref().unwrap_or("<缺失>")
    );
    println!("expectedModel: {}", report.expected_model);
    println!(
        "indexModel:    {}",
        report.index_model.as_deref().unwrap_or("<缺失>")
    );
    println!(
        "contentMatch:  {}  modelMatch: {}  integrity: {}",
        report.content_matches, report.model_matches, report.integrity_ok
    );
    if !report.matches {
        let reason = if !report.integrity_ok {
            "索引损坏或版本不支持"
        } else if !report.content_matches {
            "内容指纹不一致"
        } else {
            "embedding 模型不一致"
        };
        let detail = report
            .integrity_error
            .as_deref()
            .map(|error| format!("\n完整性问题：{error}"))
            .unwrap_or_default();
        anyhow::bail!(
            "索引需要重建（{}）：{}（indexModel={:?}, expectedModel={:?}）{}",
            reason,
            args.index.display(),
            report.index_model,
            report.expected_model,
            detail
        );
    }
    println!("status:        up-to-date");
    Ok(())
}

/// 在同步上下文构建 embedding 客户端（`reqwest::blocking` 不可在 tokio 内创建）。
fn build_embedder(args: &ServeArgs) -> Option<EmbeddingClient> {
    match args
        .embed
        .config(args.timeout_ms, 16, 1, args.max_retries)
        .and_then(|config| EmbeddingClient::new(&config))
    {
        Ok(client) => Some(client),
        Err(error) => {
            tracing::warn!(%error, "embedding 客户端初始化失败，服务以 FTS-only 运行");
            None
        }
    }
}

async fn run_serve(args: ServeArgs, embedder: Option<EmbeddingClient>) -> Result<()> {
    let started = Instant::now();
    let index = LoadedIndex::open(&args.index)?;
    let manifest = index.manifest().clone();
    store::warmup();

    let index_model = manifest.model.clone();
    let active_model = embedder.as_ref().map(|client| client.space().to_string());
    let vector_enabled = active_model.as_deref() == Some(index_model.as_str());
    if let Some(active) = active_model.as_deref() {
        if vector_enabled {
            tracing::info!(
                index_model = %index_model,
                active_model = %active,
                "embedding 模型与索引一致，启用向量检索"
            );
        } else {
            tracing::warn!(
                index_model = %index_model,
                active_model = %active,
                "embedding 模型与索引不一致：禁用向量检索，仅 FTS；请重建索引"
            );
        }
    }
    let embed_model = active_model.clone().unwrap_or_else(|| "none".to_string());
    let state = Arc::new(AppState {
        index,
        embedder,
        vector_enabled,
        started,
    });

    let listener = tokio::net::TcpListener::bind(&args.bind)
        .await
        .with_context(|| format!("监听 {} 失败", args.bind))?;
    tracing::info!(
        bind = %args.bind,
        engine = ENGINE,
        docs = state.index.chunk_count(),
        documents = manifest.documents,
        index_model = %index_model,
        active_model = %embed_model,
        vector_enabled,
        embed_dim = state.index.dim(),
        query_timeout_ms = args.timeout_ms,
        "search-server 已启动"
    );
    tracing::info!(
        built_at = %manifest.built_at_rfc3339(),
        content_hash = %manifest.content_hash,
        index = %args.index.display(),
        "索引已加载"
    );

    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("HTTP 服务异常退出")?;
    tracing::info!("search-server 已停止");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
