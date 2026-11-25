//! gaubee.com 语义搜索服务（SQLite FTS5 + magpie remote embedding）。
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
use crate::embed::{EmbeddingClient, EmbeddingConfig, DEFAULT_BASE_URL, DEFAULT_MODEL};
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
struct MagpieArgs {
    /// magpie 网关基础地址（可带 /v1 或完整 /v1/embeddings）。
    #[arg(long, default_value = DEFAULT_BASE_URL, env = "MAGPIE_URL")]
    magpie_url: String,
    /// magpie caller key；只从环境变量/命令行注入，不落盘、不打印。
    #[arg(long, env = "MAGPIE_API_KEY", hide_env_values = true)]
    magpie_api_key: Option<String>,
    /// embedding 模型名。
    #[arg(long, default_value = DEFAULT_MODEL, env = "MAGPIE_EMBED_MODEL")]
    magpie_embed_model: String,
}

impl MagpieArgs {
    fn config(
        &self,
        timeout_ms: u64,
        batch_size: usize,
        concurrency: usize,
        retries: u32,
    ) -> EmbeddingConfig {
        EmbeddingConfig {
            base_url: self.magpie_url.clone(),
            api_key: self.magpie_api_key.clone().unwrap_or_default(),
            model: self.magpie_embed_model.clone(),
            timeout: Duration::from_millis(timeout_ms),
            batch_size,
            concurrency,
            max_retries: retries,
        }
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
    magpie: MagpieArgs,
    /// 每请求 embedding 条数（mistral 实测 48 可用、64 超 token 上限，默认 48）。
    #[arg(long, default_value_t = 48, env = "EMBED_BATCH_SIZE")]
    embed_batch_size: usize,
    /// 并发 embedding 请求数（默认 4）。
    #[arg(long, default_value_t = 4, env = "EMBED_CONCURRENCY")]
    embed_concurrency: usize,
    /// 构建期单请求超时（毫秒）。
    #[arg(long, default_value_t = 120_000, env = "MAGPIE_BUILD_TIMEOUT_MS")]
    timeout_ms: u64,
    /// 429/5xx/超时重试次数。
    #[arg(long, default_value_t = 5, env = "MAGPIE_MAX_RETRIES")]
    max_retries: u32,
}

#[derive(Args)]
struct ServeArgs {
    #[arg(long, default_value = "./index.sqlite", env = "INDEX_FILE")]
    index: PathBuf,
    #[arg(long, default_value = "127.0.0.1:17082", env = "SEARCH_BIND")]
    bind: String,
    #[command(flatten)]
    magpie: MagpieArgs,
    /// 查询 embedding 超时（毫秒）；超时自动降级 FTS-only。
    #[arg(long, default_value_t = 2_000, env = "MAGPIE_TIMEOUT_MS")]
    timeout_ms: u64,
    /// 查询 embedding 重试次数；默认 0，超时立即降级，避免放大客户端超时。
    #[arg(long, default_value_t = 0, env = "MAGPIE_QUERY_RETRIES")]
    max_retries: u32,
}

#[derive(Args)]
struct CheckArgs {
    #[arg(long, default_value = "../src/content", env = "CONTENT_DIR")]
    content: PathBuf,
    #[arg(long, default_value = "./index.sqlite", env = "INDEX_FILE")]
    index: PathBuf,
    /// 当前要使用的 embedding 模型；与索引 manifest.model 不一致即视为 stale。
    #[arg(long, default_value = DEFAULT_MODEL, env = "MAGPIE_EMBED_MODEL")]
    model: String,
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
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("创建 tokio runtime 失败");
            match runtime {
                Ok(runtime) => runtime.block_on(run_serve(args)),
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
    let embedding = args.magpie.config(
        args.timeout_ms,
        args.embed_batch_size,
        args.embed_concurrency,
        args.max_retries,
    );
    let report = build_index(&BuildOptions {
        content_root: args.content,
        index_path: args.index.clone(),
        embedding,
    })?;
    println!(
        "索引构建完成：{} 篇文档 / {} chunks，耗时 {:.1}s，索引 {:.1} MiB",
        report.documents,
        report.chunks,
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
    let report = check_index(&args.content, &args.index, &args.model)?;
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
        "contentMatch:  {}  modelMatch: {}",
        report.content_matches, report.model_matches
    );
    if !report.matches {
        let reason = if !report.content_matches {
            "内容指纹不一致"
        } else {
            "embedding 模型不一致"
        };
        anyhow::bail!(
            "索引需要重建（{}）：{}（indexModel={:?}, expectedModel={:?}）",
            reason,
            args.index.display(),
            report.index_model,
            report.expected_model
        );
    }
    println!("status:        up-to-date");
    Ok(())
}

async fn run_serve(args: ServeArgs) -> Result<()> {
    let started = Instant::now();
    let index = LoadedIndex::open(&args.index)?;
    let manifest = index.manifest().clone();
    store::warmup();

    let embedder = if args
        .magpie
        .magpie_api_key
        .as_deref()
        .map(str::trim)
        .is_some_and(|key| !key.is_empty())
    {
        let config = args.magpie.config(args.timeout_ms, 64, 1, args.max_retries);
        match EmbeddingClient::new(&config) {
            Ok(client) => Some(client),
            Err(error) => {
                tracing::warn!(%error, "embedding 客户端初始化失败，服务以 FTS-only 运行");
                None
            }
        }
    } else {
        tracing::warn!("MAGPIE_API_KEY 未配置，服务以 FTS-only 运行（响应 degraded=true）");
        None
    };

    let index_model = manifest.model.clone();
    let active_model = embedder.as_ref().map(|client| client.model().to_string());
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
