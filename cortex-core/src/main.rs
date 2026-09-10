//! CORTEX Core — single-binary memory engine.
//!
//! The default path requires **no infrastructure**: the graph lives in one JSON
//! file under `~/.cortex`, extraction is heuristic unless an API key is present,
//! and the server binds to loopback unless a key is configured. SurrealDB,
//! Qdrant and mesh publishing are opt-in, each with a loud log line about which
//! mode it ended up in — the banner never claims a capability it does not have.

// The binary is a thin wiring layer over the library: no `mod` declarations
// here, because a second copy of every module would be compiled into the bin and
// the integration tests would then exercise a different tree than the one users
// run. `cargo test` and `cortex-core` share one source of truth.
use cortex_core::api::server::{
    flush_all_sessions, spawn_background, start_server, AppState, CoreConfig, JobRegistry,
};
use cortex_core::ai::openrouter::{OpenRouterClient, DEFAULT_MODEL};
use cortex_core::storage::graph_db::GraphMemory;
use cortex_core::storage::graph_store::GraphStore;
use cortex_core::storage::session::SessionBuffer;
use cortex_core::storage::store::FileGraphStore;
use cortex_core::storage::vector_db::VectorIndex;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn env_str(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn env_num<T: std::str::FromStr>(key: &str) -> Option<T> {
    env_str(key).and_then(|v| v.parse::<T>().ok())
}

/// `~/.cortex` unless `CORTEX_DATA_DIR` says otherwise. Never fails: an
/// unwritable home falls back to `./.cortex` and the ping in `/health` is what
/// ultimately reports whether storage works.
fn data_dir() -> PathBuf {
    if let Some(dir) = env_str("CORTEX_DATA_DIR") {
        return PathBuf::from(dir);
    }
    let home = env_str("HOME")
        .or_else(|| env_str("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    home.join(".cortex")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,cortex_core=info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let config = Arc::new(CoreConfig::from_env());
    let dir = data_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| anyhow::anyhow!("cannot create data directory {}: {e}", dir.display()))?;

    tracing::info!(version = config.version, "CORTEX Core starting");

    // --- graph store: file by default, SurrealDB when explicitly pointed at it
    let mut backend_note = String::new();
    let store = match env_str("CORTEX_SURREAL_URL").or_else(|| env_str("SURREALDB_URL")) {
        Some(url) => {
            let user = env_str("CORTEX_SURREAL_USER").unwrap_or_else(|| "root".into());
            let pass = env_str("CORTEX_SURREAL_PASS").unwrap_or_else(|| "cortex".into());
            let ns = env_str("CORTEX_SURREAL_NS").unwrap_or_else(|| "cortex".into());
            let db = env_str("CORTEX_SURREAL_DB").unwrap_or_else(|| "memory".into());
            match GraphMemory::new(&url, &user, &pass, &ns, &db).await {
                Ok(graph) => {
                    let graph = Arc::new(graph);
                    if !graph.ping().await.is_ok() {
                        anyhow::bail!("SurrealDB at {url} connected but did not answer a query");
                    }
                    backend_note = format!("surrealdb @ {url}");
                    GraphStore::Surreal(graph)
                }
                Err(err) => {
                    // Falling back silently would put writes somewhere the
                    // operator is not looking, so make the choice explicit.
                    if env_str("CORTEX_REQUIRE_SURREAL").is_some() {
                        return Err(anyhow::anyhow!("SurrealDB unavailable: {err}"));
                    }
                    tracing::warn!(error = %err, "SurrealDB unavailable — falling back to the local file store");
                    backend_note = format!("file (SurrealDB {url} unreachable)");
                    GraphStore::File(Arc::new(FileGraphStore::open(dir.join("cortex-graph.json")).await?))
                }
            }
        }
        None => {
            let path = dir.join("cortex-graph.json");
            let file = FileGraphStore::open(&path).await?;
            backend_note = format!("file @ {}", path.display());
            GraphStore::File(Arc::new(file))
        }
    };
    let (node_count, edge_count) = store.counts().await.unwrap_or((0, 0));
    tracing::info!(backend = %backend_note, nodes = node_count, edges = edge_count, "graph store ready");

    // --- optional Qdrant vector index (opt-in; absence is not an error)
    let vector = match env_str("CORTEX_QDRANT_URL").or_else(|| env_str("QDRANT_URL")) {
        Some(url) => match VectorIndex::new(&url, "cortex_nodes") {
            Ok(index) => {
                let probed =
                    tokio::time::timeout(std::time::Duration::from_secs(3), index.ensure_collection())
                        .await;
                match probed {
                    Ok(Ok(())) => {
                        tracing::info!("vector index ready @ {url}");
                        Some(Arc::new(index))
                    }
                    _ => {
                        tracing::warn!("Qdrant at {url} is not answering — continuing without a vector index");
                        None
                    }
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "invalid Qdrant configuration — continuing without a vector index");
                None
            }
        },
        None => None,
    };

    // --- Shadow Kernel: an LLM extractor only when a usable key exists
    let extractor = env_str("OPENROUTER_API_KEY")
        .filter(|key| key.len() > 12 && !key.contains("..."))
        .map(|key| {
            let model = env_str("CORTEX_EXTRACTOR_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_string());
            tracing::info!(model = %model, "LLM triplet extraction enabled");
            Arc::new(OpenRouterClient::with_model(key, model))
        });
    if extractor.is_none() {
        tracing::info!("no OPENROUTER_API_KEY — using the offline heuristic extractor");
    }

    // --- shared mesh (opt-in, separate store so local memory is never mutated)
    let mesh_sink = if config.allow_mesh_publish {
        match env_str("CORTEX_MESH_PATH") {
            Some(path) => {
                let sink = FileGraphStore::open(&path)
                    .await
                    .map_err(|e| anyhow::anyhow!("CORTEX_MESH_PATH={path} unusable: {e}"))?;
                tracing::warn!(path, "shared mesh publishing is ENABLED");
                Some(Arc::new(GraphStore::File(Arc::new(sink))))
            }
            None => {
                tracing::warn!("CORTEX_ALLOW_MESH_PUBLISH is set but CORTEX_MESH_PATH is not — publish will report unavailable");
                None
            }
        }
    } else {
        None
    };

    let idle_secs = env_num::<i64>("CORTEX_SESSION_IDLE_SECS").unwrap_or(90);
    let max_msgs = env_num::<usize>("CORTEX_SESSION_MAX_MESSAGES").unwrap_or(40);

    let state = AppState {
        store,
        sessions: Arc::new(SessionBuffer::new(idle_secs, max_msgs, 256)),
        extractor,
        mesh_sink,
        jobs: Arc::new(Mutex::new(JobRegistry::default())),
        inflight: Arc::new(tokio::sync::Semaphore::new(
            env_num::<usize>("CORTEX_MAX_CONCURRENT_JOBS")
                .unwrap_or(8)
                .clamp(1, 64),
        )),
        ws_tx: Arc::new(tokio::sync::broadcast::channel(256).0),
        config: config.clone(),
        started_at: chrono::Utc::now(),
        rate: Arc::new(Mutex::new(HashMap::<IpAddr, (u32, i64)>::new())),
        vector,
    };

    let shutdown_state = state.clone();
    spawn_background(state.clone());

    println!();
    println!("  CORTEX Core v{} — local universal memory engine", config.version);
    println!("  ------------------------------------------------------------");
    println!("  api         http://{}:{}", config.host, config.port);
    println!("  storage     {backend_note}");
    println!("  health      http://{}:{}/health", config.host, config.port);
    println!(
        "  extraction  {}",
        match &state.extractor {
            Some(client) => format!("OpenRouter · {}", client.model_label()),
            None => "offline heuristics (set OPENROUTER_API_KEY for full extraction)".to_string(),
        }
    );
    println!(
        "  auth        {}",
        if config.api_key.is_some() {
            "bearer token required".to_string()
        } else {
            "loopback only (set CORTEX_API_KEY to expose)".to_string()
        }
    );
    println!(
        "  forgetting  {} (locked facts are never forgotten)",
        config.decay.policy.as_str()
    );
    println!("  clients     set CORTEX_API_URL=http://{}:{}", config.host, config.port);
    println!();

    let result = start_server(state).await;

    // Whatever the reason we stopped, do not drop the tail of a conversation.
    let flushed = flush_all_sessions(&shutdown_state).await;
    if flushed > 0 {
        tracing::info!(sessions = flushed, "flushed pending sessions on shutdown");
    }
    if let Err(err) = &result {
        tracing::error!(error = %err, "server exited with an error");
    }
    result
}
