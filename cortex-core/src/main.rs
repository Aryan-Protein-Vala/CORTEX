pub mod types;
pub mod ai;
pub mod storage;
pub mod engine;
pub mod api;

use std::sync::Arc;
use tokio::sync::broadcast;
use crate::api::server::AppState;
use crate::engine::decay::DecayEngine;
use crate::engine::overwrite::StateOverwriteEngine;
use crate::storage::graph_db::GraphMemory;
use crate::storage::vector_db::VectorIndex;
use crate::storage::working_memory::WorkingMemory;
use crate::ai::openrouter::OpenRouterClient;
use crate::engine::crawler::CrawlerEngine;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🧠 ==========================================");
    println!("🧠 CORTEX CORE UNIVERSAL MEMORY ENGINE v2.0");
    println!("🧠 ==========================================");

    let surreal_url = std::env::var("SURREALDB_URL").unwrap_or_else(|_| "ws://localhost:8000".to_string());
    let surreal_user = std::env::var("SURREALDB_USER").unwrap_or_else(|_| "root".to_string());
    let surreal_pass = std::env::var("SURREALDB_PASS").unwrap_or_else(|_| "cortex_god".to_string());
    let qdrant_url = std::env::var("QDRANT_URL").unwrap_or_else(|_| "http://localhost:6334".to_string());
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let openrouter_key = std::env::var("OPENROUTER_API_KEY").ok();
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3030);

    // 1. Initialize Graph Database (SurrealDB)
    let graph = match GraphMemory::new(&surreal_url, &surreal_user, &surreal_pass, "cortex", "memory").await {
        Ok(gm) => {
            println!("✅ Connected to SurrealDB Graph Mesh at {}", surreal_url);
            Some(Arc::new(gm))
        }
        Err(e) => {
            println!("⚠️  SurrealDB unavailable ({}). Running in memory-lite mode.", e);
            None
        }
    };

    // 2. Initialize Vector Database (Qdrant)
    let vector_idx = match VectorIndex::new(&qdrant_url, "cortex_nodes") {
        Ok(vi) => {
            let _ = vi.ensure_collection().await;
            println!("✅ Connected to Qdrant Vector Index at {}", qdrant_url);
            Some(Arc::new(vi))
        }
        Err(e) => {
            println!("⚠️  Qdrant unavailable ({}). Running without vector index.", e);
            None
        }
    };

    // 3. Initialize Working Memory (Redis/Dragonfly)
    let working_mem = match WorkingMemory::new(&redis_url) {
        Ok(wm) => {
            println!("✅ Connected to Dragonfly Working Memory at {}", redis_url);
            Some(Arc::new(wm))
        }
        Err(e) => {
            println!("⚠️  Dragonfly unavailable ({}).", e);
            None
        }
    };

    // 4. Initialize Shadow Kernel AI Extractor
    let openrouter_client = match openrouter_key {
        Some(ref key) if !key.is_empty() && !key.starts_with("sk-or-v1-...") => {
            println!("✅ OpenRouter AI Extraction Kernel initialized.");
            Some(Arc::new(OpenRouterClient::new(key.clone())))
        }
        _ => {
            println!("ℹ️  OPENROUTER_API_KEY not set. Using heuristic triplet extraction.");
            None
        }
    };

    let decay = Arc::new(DecayEngine::new());
    let overwrite = Arc::new(StateOverwriteEngine::new());
    let (ws_tx, _) = broadcast::channel(100);

    let cortex_api_key = std::env::var("CORTEX_API_KEY").ok();

    let state = AppState {
        graph: graph.clone(),
        vector: vector_idx,
        working: working_mem,
        openrouter: openrouter_client,
        crawler: Arc::new(tokio::sync::Mutex::new(CrawlerEngine::new())),
        decay: decay.clone(),
        overwrite: overwrite.clone(),
        ws_tx: ws_tx.clone(),
        api_key: cortex_api_key,
    };

    // 5. Spawn background Ebbinghaus decay sweep task (runs every 60 minutes)
    let sweep_graph = graph.clone();
    let sweep_decay = decay.clone();
    let sweep_ws = ws_tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Some(ref g) = sweep_graph {
                match g.sweep_decay(&sweep_decay).await {
                    Ok(pruned) => {
                        if pruned > 0 {
                            println!("🍂 [DECAY] Ebbinghaus sweep pruned {} forgotten memories.", pruned);
                            let _ = sweep_ws.send(r#"{"type":"WS_DECAY"}"#.to_string());
                        }
                    }
                    Err(e) => {
                        eprintln!("⚠️  [DECAY] Sweep error: {}", e);
                    }
                }
            }
        }
    });

    // 6. Start API Server
    api::server::start_server(port, state).await?;

    Ok(())
}
