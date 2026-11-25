//! gaubee.com 语义搜索服务（zvec + E5-small ONNX）。
//!
//! 用法：
//!   cargo run --release -- build     # 全量重建索引到 ./index
//!   cargo run --release -- serve     # 监听 127.0.0.1:17081
mod api;
mod chunk;
mod content;
mod embed;
mod indexer;
mod manifest;
mod search;
mod store;
mod zvec_ffi;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use crate::api::{router, AppState};
use crate::embed::Embedder;
use crate::indexer::{build_index, ensure_index_root, BuildOptions};
use crate::manifest::{collection_path, read_manifest};
use crate::store::ZvecStore;

#[derive(Parser)]
#[command(
    name = "search-server",
    version,
    about = "gaubee.com zvec 语义搜索服务"
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
}

#[derive(clap::Args)]
struct BuildArgs {
    /// 内容根目录（含 articles/events 子目录）。
    #[arg(long, default_value = "../src/content", env = "CONTENT_DIR")]
    content: PathBuf,
    /// 索引输出根目录（collection/ + manifest.json）。
    #[arg(long, default_value = "./index", env = "INDEX_DIR")]
    index: PathBuf,
    /// E5 模型目录（model.onnx + tokenizer.json）。
    #[arg(
        long,
        default_value = "./.cache/models/multilingual-e5-small",
        env = "MODEL_DIR"
    )]
    model_dir: PathBuf,
    /// ONNX 推理线程数。
    #[arg(long, default_value_t = 4, env = "SEARCH_THREADS")]
    threads: usize,
}

#[derive(clap::Args)]
struct ServeArgs {
    #[arg(long, default_value = "./index", env = "INDEX_DIR")]
    index: PathBuf,
    #[arg(
        long,
        default_value = "./.cache/models/multilingual-e5-small",
        env = "MODEL_DIR"
    )]
    model_dir: PathBuf,
    #[arg(long, default_value = "127.0.0.1:17081", env = "SEARCH_BIND")]
    bind: String,
    #[arg(long, default_value_t = 4, env = "SEARCH_THREADS")]
    threads: usize,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Build(args) => run_build(args),
        Command::Serve(args) => {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .context("创建 tokio runtime 失败")?;
            runtime.block_on(run_serve(args))
        }
    }
}

fn run_build(args: BuildArgs) -> Result<()> {
    let report = build_index(&BuildOptions {
        content_root: args.content,
        index_root: args.index.clone(),
        model_dir: args.model_dir,
        threads: args.threads,
    })?;
    println!(
        "索引构建完成：{} 篇文档 / {} chunks，耗时 {:.1}s，索引 {:.1} MiB",
        report.documents,
        report.chunks,
        report.duration_ms as f64 / 1000.0,
        report.index_bytes as f64 / (1024.0 * 1024.0),
    );
    println!("collection: {}", collection_path(&args.index).display());
    println!(
        "manifest:   {}",
        manifest::manifest_path(&args.index).display()
    );
    println!(
        "stats:      {}",
        serde_json::to_string(&report.manifest).unwrap_or_default()
    );
    Ok(())
}

async fn run_serve(args: ServeArgs) -> Result<()> {
    ensure_index_root(&args.index)?;
    let started = Instant::now();
    let collection = collection_path(&args.index);
    // 优先只读（索引可挂载为只读卷）；若索引有未完成 WAL 则回退读写打开。
    let store = match ZvecStore::open_read_only(&collection) {
        Ok(store) => store,
        Err(error) => {
            tracing::warn!(%error, "只读打开失败，回退读写模式");
            ZvecStore::open(&collection)?
        }
    };
    let docs = store.doc_count()?;
    let manifest = read_manifest(&args.index)?;
    let embedder = Embedder::load(
        &args.model_dir.join("model.onnx"),
        &args.model_dir.join("tokenizer.json"),
        args.threads,
    )?;

    // 预热：加载 HNSW / FTS 段并跑一次 query embedding。
    if let Err(error) = embedder.embed_query("warmup") {
        tracing::warn!(%error, "查询 embedding 预热失败");
    }

    let state = Arc::new(AppState {
        store,
        embedder,
        index_root: args.index.clone(),
        manifest: manifest.clone(),
        started,
    });

    let listener = tokio::net::TcpListener::bind(&args.bind)
        .await
        .with_context(|| format!("监听 {} 失败", args.bind))?;
    tracing::info!(
        bind = %args.bind,
        docs,
        zvec = %crate::store::sdk_version(),
        "search-server 已启动"
    );
    if let Some(manifest) = &manifest {
        tracing::info!(
            built_at = %manifest.built_at_rfc3339(),
            documents = manifest.documents,
            chunks = manifest.chunks,
            index = %args.index.display(),
            "索引已加载"
        );
    }

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
