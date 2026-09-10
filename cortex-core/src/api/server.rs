use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        State, Query
    },
    http::{header, Method},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use anyhow::Result;

use crate::ai::openrouter::OpenRouterClient;
use crate::engine::decay::DecayEngine;
use crate::engine::overwrite::StateOverwriteEngine;
use crate::storage::graph_db::GraphMemory;
use crate::storage::vector_db::VectorIndex;
use crate::storage::working_memory::WorkingMemory;
use crate::types::{CortexContextPacket, MemoryNode, Message, RelationalEdge, SemanticTriplet};

#[derive(Clone)]
pub struct AppState {
    pub graph: Option<Arc<GraphMemory>>,
    pub vector: Option<Arc<VectorIndex>>,
    pub working: Option<Arc<WorkingMemory>>,
    pub openrouter: Option<Arc<OpenRouterClient>>,
    pub decay: Arc<DecayEngine>,
    pub overwrite: Arc<StateOverwriteEngine>,
    pub ws_tx: broadcast::Sender<String>,
    pub api_key: Option<String>,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub services: ServiceStatus,
}

#[derive(Serialize)]
pub struct ServiceStatus {
    pub graph_db: bool,
    pub vector_db: bool,
    pub working_memory: bool,
    pub ai_extraction: bool,
}

#[derive(Deserialize)]
pub struct RecallRequest {
    pub user_id: Option<String>,
    pub prompt: String,
    pub token_budget: Option<u32>,
}

#[derive(Deserialize)]
pub struct ResolveRequest {
    pub uri: String,
    // Optional: include_mesh flag to fetch global mesh data alongside personal data
    #[serde(default)]
    pub include_mesh: bool,
}

#[derive(Serialize)]
pub struct RecallResponse {
    pub briefing: String,
    pub node_count: usize,
    pub edge_count: usize,
}

#[derive(Deserialize)]
pub struct IngestRequest {
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub prompt: Option<String>,
    pub messages: Option<Vec<Message>>,
}

#[derive(Serialize)]
pub struct IngestResponse {
    pub success: bool,
    pub triplets_extracted: usize,
    pub nodes_upserted: usize,
    pub edges_upserted: usize,
    pub message: String,
}

#[derive(Serialize)]
pub struct SweepResponse {
    pub success: bool,
    pub pruned_items: usize,
}

#[derive(Deserialize)]
pub struct MeshPublishRequest {
    pub nodes: Vec<MemoryNode>,
    pub edges: Vec<RelationalEdge>,
}

#[derive(Serialize)]
pub struct MeshPublishResponse {
    pub success: bool,
    pub message: String,
}

/// Start the Cortex Core Engine API Server
pub async fn start_server(port: u16, state: AppState) -> Result<()> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT]);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/v1/recall", post(recall_context))
        .route("/v1/ingest", post(ingest_context))
        .route("/v1/inject", post(inject_uri_memory))
        .route("/v1/sweep", post(trigger_sweep))
        .route("/v1/resolve", get(resolve_uri))
        .route("/v1/mesh/publish", post(publish_to_mesh_endpoint))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    
    println!("🧠 Cortex Core API running on http://{}", addr);
    println!("🧠 Cortex Core WebSocket active on ws://{}/ws", addr);
    
    axum::serve(listener, app).await?;
    
    Ok(())
}

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: "2.0".to_string(),
        services: ServiceStatus {
            graph_db: state.graph.is_some(),
            vector_db: state.vector.is_some(),
            working_memory: state.working.is_some(),
            ai_extraction: state.openrouter.is_some(),
        },
    })
}

/// Resolves a custom protocol URI (e.g., cortex://user_123 or cortex://team_xyz) 
/// and returns the associated graph for SDK ingestion.
async fn resolve_uri(
    State(state): State<AppState>,
    Query(payload): Query<ResolveRequest>,
) -> impl IntoResponse {
    let mut retrieved_nodes = Vec::new();
    let mut retrieved_edges = Vec::new();

    if let Some(ref graph) = state.graph {
        // Fetch personal / specific URI context
        if let Ok(nodes) = graph.get_nodes_by_owner(&payload.uri).await {
            retrieved_nodes.extend(nodes);
        }
        if let Ok(edges) = graph.get_edges_by_owner(&payload.uri).await {
            retrieved_edges.extend(edges);
        }
        
        // Fetch Global Mesh context if requested (or default behavior)
        if payload.include_mesh && payload.uri != "cortex://global" {
            if let Ok(nodes) = graph.get_nodes_by_owner("cortex://global").await {
                retrieved_nodes.extend(nodes);
            }
            if let Ok(edges) = graph.get_edges_by_owner("cortex://global").await {
                retrieved_edges.extend(edges);
            }
        }
    }

    // Deduplicate nodes and edges based on ID
    let mut seen_node_ids = std::collections::HashSet::new();
    retrieved_nodes.retain(|n| seen_node_ids.insert(n.id.clone()));

    let mut seen_edge_ids = std::collections::HashSet::new();
    retrieved_edges.retain(|e| seen_edge_ids.insert(e.id.clone()));

    let context_str = if retrieved_edges.is_empty() && retrieved_nodes.is_empty() {
        format!("No prior memories recorded under {}", payload.uri)
    } else {
        let mut summaries: Vec<String> = Vec::new();
        if !retrieved_nodes.is_empty() {
            let labels: Vec<&str> = retrieved_nodes.iter().map(|n| n.label.as_str()).collect();
            summaries.push(format!("Known concepts: {}", labels.join(", ")));
        }
        for e in &retrieved_edges {
            summaries.push(format!("Relationship: {} -> [{}] -> {}", e.source, e.predicate, e.target));
        }
        summaries.join("\n")
    };

    let packet = CortexContextPacket {
        user_id: payload.uri.clone(),
        nodes: retrieved_nodes,
        edges: retrieved_edges,
        rules: vec![],
        token_estimate: 0,
        context: context_str,
    };

    Json(packet)
}

/// Publish context to the global mesh
async fn publish_to_mesh_endpoint(
    State(state): State<AppState>,
    Json(payload): Json<MeshPublishRequest>,
) -> impl IntoResponse {
    if let Some(ref graph) = state.graph {
        let _ = graph.publish_to_mesh(payload.nodes, payload.edges).await;
    }
    
    Json(MeshPublishResponse {
        success: true,
        message: "Successfully pushed context to the Global Mesh".to_string(),
    })
}

#[derive(Deserialize)]
pub struct InjectRequest {
    pub uri: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct InjectResponse {
    pub success: bool,
    pub message: String,
    pub triplets_extracted: usize,
    pub nodes_upserted: usize,
    pub edges_upserted: usize,
}

/// Injects memory into a specific URI namespace via the SDKs
async fn inject_uri_memory(
    State(state): State<AppState>,
    Json(payload): Json<InjectRequest>,
) -> impl IntoResponse {
    let ingest_req = IngestRequest {
        user_id: Some(payload.uri.clone()),
        session_id: None,
        prompt: Some(payload.text),
        messages: None,
    };
    
    let res = ingest_internal(&state, ingest_req, Some(payload.uri)).await;
    Json(InjectResponse {
        success: res.success,
        message: res.message,
        triplets_extracted: res.triplets_extracted,
        nodes_upserted: res.nodes_upserted,
        edges_upserted: res.edges_upserted,
    })
}

/// The main endpoint for getting contextual briefings for prompts
async fn recall_context(
    State(state): State<AppState>,
    Json(payload): Json<RecallRequest>,
) -> impl IntoResponse {
    let mut retrieved_nodes = Vec::new();
    let mut retrieved_edges = Vec::new();

    // 1. Vector similarity search: map prompt to candidate node IDs
    let mut candidate_ids = Vec::new();
    if let Some(ref vector) = state.vector {
        let query_vec = vector.embed_text(&payload.prompt);
        if let Ok(node_ids) = vector.map_to_node(query_vec, 5).await {
            candidate_ids.extend(node_ids);
        }
    }

    // 2. Graph retrieval: traverse from candidate nodes
    if let Some(ref graph) = state.graph {
        for cid in &candidate_ids {
            if let Ok((nodes, edges)) = graph.traverse(cid, 2).await {
                for n in nodes {
                    if !retrieved_nodes.iter().any(|rn: &MemoryNode| rn.id == n.id) {
                        retrieved_nodes.push(n);
                    }
                }
                for e in edges {
                    if !retrieved_edges.iter().any(|re: &RelationalEdge| re.id == e.id) {
                        retrieved_edges.push(e);
                    }
                }
            }
        }

        // If candidates via vector didn't hit, look for direct keyword match in labels
        if retrieved_nodes.is_empty() {
            let tokens: Vec<&str> = payload.prompt.split_whitespace().collect();
            for token in tokens {
                if token.len() > 3 {
                    if let Ok(Some(node)) = graph.find_node_by_label(token).await {
                        if let Ok((nodes, edges)) = graph.traverse(&node.id, 1).await {
                            retrieved_nodes.extend(nodes);
                            retrieved_edges.extend(edges);
                            break;
                        }
                    }
                }
            }
        }
    }

    // Broadcast a neural synapse pulse to the live frontend visualizer
    let _ = state.ws_tx.send(r#"{"type":"WS_SYNAPSE_PULSE"}"#.to_string());

    let context_str = if retrieved_edges.is_empty() && retrieved_nodes.is_empty() {
        "No prior relevant memories found for this prompt.".to_string()
    } else {
        let mut parts = Vec::new();
        if !retrieved_nodes.is_empty() {
            let labels: Vec<&str> = retrieved_nodes.iter().map(|n| n.label.as_str()).collect();
            parts.push(format!("Known concepts: {}", labels.join(", ")));
        }
        for edge in &retrieved_edges {
            parts.push(format!("Fact: {} -> [{}] -> {}", edge.source, edge.predicate, edge.target));
        }
        parts.join("\n")
    };

    let packet = CortexContextPacket {
        user_id: payload.user_id.unwrap_or_else(|| "default_user".to_string()),
        nodes: retrieved_nodes.clone(),
        edges: retrieved_edges.clone(),
        rules: vec![],
        token_estimate: payload.token_budget.unwrap_or(500),
        context: context_str,
    };

    let briefing_json = serde_json::to_string(&packet)
        .unwrap_or_else(|_| "{}".to_string());

    Json(RecallResponse {
        briefing: briefing_json,
        node_count: retrieved_nodes.len(),
        edge_count: retrieved_edges.len(),
    })
}

/// Ingest conversational turns and extract semantic knowledge
async fn ingest_context(
    State(state): State<AppState>,
    Json(payload): Json<IngestRequest>,
) -> impl IntoResponse {
    let owner = payload.user_id.clone().unwrap_or_else(|| "cortex://default".to_string());
    let res = ingest_internal(&state, payload, Some(owner)).await;
    Json(res)
}

async fn ingest_internal(
    state: &AppState,
    payload: IngestRequest,
    forced_owner: Option<String>,
) -> IngestResponse {
    let mut full_log = String::new();
    
    if let Some(ref prompt) = payload.prompt {
        let bounded_prompt: String = prompt.chars().take(16000).collect();
        full_log.push_str(&bounded_prompt);
        full_log.push('\n');
    }

    if let Some(ref messages) = payload.messages {
        let bounded_messages = if messages.len() > 50 {
            &messages[messages.len() - 50..]
        } else {
            &messages[..]
        };
        for msg in bounded_messages {
            let bounded_content: String = msg.content.chars().take(2000).collect();
            full_log.push_str(&format!("{:?}: {}\n", msg.role, bounded_content));
        }
    }

    let mut extracted_triplets = Vec::new();

    // 1. AI Extraction using OpenRouter (Shadow Kernel)
    if let Some(ref ai) = state.openrouter {
        if !full_log.trim().is_empty() {
            if let Ok(triplets) = ai.extract_triplets(&full_log).await {
                extracted_triplets = triplets;
            }
        }
    }

    // Fallback: heuristic extraction if OpenRouter is offline or empty
    if extracted_triplets.is_empty() && !full_log.trim().is_empty() {
        let lines: Vec<&str> = full_log.lines().collect();
        for line in lines {
            let line = line.trim();
            if line.contains(" prefers ") {
                let parts: Vec<&str> = line.split(" prefers ").collect();
                if parts.len() == 2 {
                    extracted_triplets.push(SemanticTriplet {
                        subject: parts[0].trim().to_string(),
                        predicate: "prefers".to_string(),
                        object: parts[1].trim().to_string(),
                        confidence: 0.8,
                        impact: 7,
                        overwrite: false,
                    });
                }
            } else if line.contains(" uses ") {
                let parts: Vec<&str> = line.split(" uses ").collect();
                if parts.len() == 2 {
                    extracted_triplets.push(SemanticTriplet {
                        subject: parts[0].trim().to_string(),
                        predicate: "uses".to_string(),
                        object: parts[1].trim().to_string(),
                        confidence: 0.8,
                        impact: 5,
                        overwrite: false,
                    });
                }
            } else if line.contains(" hates ") {
                let parts: Vec<&str> = line.split(" hates ").collect();
                if parts.len() == 2 {
                    extracted_triplets.push(SemanticTriplet {
                        subject: parts[0].trim().to_string(),
                        predicate: "hates".to_string(),
                        object: parts[1].trim().to_string(),
                        confidence: 0.9,
                        impact: 8,
                        overwrite: false,
                    });
                }
            }
        }
    }

    let mut nodes_upserted = 0;
    let mut edges_upserted = 0;

    let owner_uri = forced_owner
        .or(payload.user_id)
        .unwrap_or_else(|| "cortex://default".to_string());

    if let Some(ref graph) = state.graph {
        let mut existing_edges = graph.get_all_edges().await.unwrap_or_default();

        for triplet in &extracted_triplets {
            // Find or create subject node (deduplication)
            let subject_node = match graph.find_node_by_label(&triplet.subject).await {
                Ok(Some(mut n)) => {
                    n.mark_accessed();
                    n.owner_uri = owner_uri.clone();
                    let _ = graph.upsert_node(&n).await;
                    n
                }
                _ => {
                    let mut n = MemoryNode::new(&triplet.subject);
                    n.impact = triplet.impact;
                    n.owner_uri = owner_uri.clone();
                    let _ = graph.upsert_node(&n).await;
                    nodes_upserted += 1;
                    n
                }
            };

            // Find or create object node (deduplication)
            let object_node = match graph.find_node_by_label(&triplet.object).await {
                Ok(Some(mut n)) => {
                    n.mark_accessed();
                    n.owner_uri = owner_uri.clone();
                    let _ = graph.upsert_node(&n).await;
                    n
                }
                _ => {
                    let mut n = MemoryNode::new(&triplet.object);
                    n.impact = triplet.impact;
                    n.owner_uri = owner_uri.clone();
                    let _ = graph.upsert_node(&n).await;
                    nodes_upserted += 1;
                    n
                }
            };

            // Check overwrite/contradiction
            let mut new_edge = match state.overwrite.apply_overwrite(
                triplet,
                &subject_node.id,
                &object_node.id,
                &mut existing_edges,
            ) {
                Ok(Some(corrected_edge)) => corrected_edge,
                _ => RelationalEdge::new(
                    &subject_node.id,
                    &triplet.predicate,
                    &object_node.id,
                    triplet.confidence,
                ),
            };
            new_edge.owner_uri = owner_uri.clone();

            let _ = graph.upsert_edge(&new_edge).await;
            edges_upserted += 1;

            // Upsert vector embeddings for semantic lookup
            if let Some(ref vector) = state.vector {
                let s_vec = vector.embed_text(&subject_node.label);
                let o_vec = vector.embed_text(&object_node.label);
                let _ = vector.upsert_mapping(&subject_node.id, s_vec).await;
                let _ = vector.upsert_mapping(&object_node.id, o_vec).await;
            }
        }
    }

    let _ = state.ws_tx.send(r#"{"type":"WS_SYNAPSE_PULSE"}"#.to_string());

    IngestResponse {
        success: true,
        triplets_extracted: extracted_triplets.len(),
        nodes_upserted,
        edges_upserted,
        message: format!(
            "Ingested {} triplets, {} nodes, {} edges for {}.",
            extracted_triplets.len(),
            nodes_upserted,
            edges_upserted,
            owner_uri
        ),
    }
}

async fn trigger_sweep(State(state): State<AppState>) -> impl IntoResponse {
    let mut pruned = 0;
    if let Some(ref graph) = state.graph {
        if let Ok(count) = graph.sweep_decay(&state.decay).await {
            pruned = count;
        }
    }
    
    Json(SweepResponse {
        success: true,
        pruned_items: pruned,
    })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.ws_tx.subscribe();
    
    while let Ok(msg) = rx.recv().await {
        if socket.send(WsMessage::Text(msg)).await.is_err() {
            break;
        }
    }
}
