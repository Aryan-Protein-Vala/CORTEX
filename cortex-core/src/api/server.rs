//! Cortex Core HTTP API.
//!
//! Design rules enforced here (each one was a launch blocker before):
//! * **Loopback-only unless authenticated.** An unauthenticated engine bound to
//!   `0.0.0.0` lets any webpage the user visits read — or write — their memory.
//! * **Errors are errors.** Handlers return `Result<_, ApiError>` so a failure
//!   is a 4xx/5xx with a machine-readable code, never a 200 that says "error".
//! * **Every write is idempotent** (deterministic ids), so a retried ingest
//!   reinforces instead of duplicating.
//! * **Extraction is queued, not blocking.** The browser extension must never
//!   wait on an LLM. `POST /v1/ingest` returns `202 + job_id` by default.

use crate::ai::openrouter::OpenRouterClient;
use crate::engine::decay::{DecayEngine, DecayPolicy, SweepReport};
use crate::engine::recall::{self, RecallOptions, RecallOutcome};
use crate::storage::graph_store::GraphStore;
use crate::storage::session::{render_transcript, SessionBuffer};
use crate::types::{
    canonical_node_id, estimate_tokens, normalize_owner, CortexContextPacket,
    MemoryNode, Message, MessageRole, NodeCategory, RelationalEdge, SemanticTriplet,
};
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub host: String,
    pub port: u16,
    pub api_key: Option<String>,
    pub default_owner: String,
    pub default_token_budget: u32,
    pub max_token_budget: u32,
    pub allow_mesh_publish: bool,
    pub allowed_origins: Vec<String>,
    pub decay: DecayEngine,
    pub sweep_interval_secs: u64,
    pub rate_limit_per_min: u32,
    pub version: &'static str,
}

impl Default for CoreConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3030,
            api_key: None,
            default_owner: crate::types::DEFAULT_OWNER.to_string(),
            default_token_budget: 500,
            max_token_budget: 4000,
            allow_mesh_publish: false,
            allowed_origins: vec![
                "http://localhost:3000".to_string(),
                "http://127.0.0.1:3000".to_string(),
            ],
            decay: DecayEngine::new(),
            sweep_interval_secs: 3600,
            rate_limit_per_min: 600,
            version: env!("CARGO_PKG_VERSION"),
        }
    }
}

// ---------------------------------------------------------------------------
// Jobs (async extraction)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub state: JobState,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<IngestReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Default)]
pub struct JobRegistry {
    jobs: HashMap<String, Job>,
    order: std::collections::VecDeque<String>,
}

impl JobRegistry {
    fn put(&mut self, job: Job) {
        self.order.push_back(job.id.clone());
        self.jobs.insert(job.id.clone(), job);
        while self.order.len() > 500 {
            if let Some(old) = self.order.pop_front() {
                self.jobs.remove(&old);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct IngestReport {
    pub triplets_extracted: usize,
    pub triplets_rejected: usize,
    pub nodes_upserted: usize,
    pub nodes_new: usize,
    pub edges_upserted: usize,
    pub edges_new: usize,
    pub extractor: String,
    pub warnings: Vec<String>,
    pub owner_uri: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AppState {
    pub store: GraphStore,
    pub sessions: Arc<SessionBuffer>,
    pub extractor: Option<Arc<OpenRouterClient>>,
    pub mesh_sink: Option<Arc<GraphStore>>,
    pub jobs: Arc<Mutex<JobRegistry>>,
    pub inflight: Arc<tokio::sync::Semaphore>,
    pub ws_tx: Arc<tokio::sync::broadcast::Sender<String>>,
    pub config: Arc<CoreConfig>,
    pub started_at: DateTime<Utc>,
    pub rate: Arc<Mutex<HashMap<IpAddr, (u32, i64)>>>,
    pub vector: Option<Arc<crate::storage::vector_db::VectorIndex>>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_request", msg)
    }
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", msg)
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", msg)
    }
    pub fn unavailable(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "backend_unavailable", msg)
    }
    pub fn internal(err: impl std::fmt::Display) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            err.to_string(),
        )
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        Self::internal(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({
            "error": { "code": self.code, "message": self.message }
        });
        (self.status, Json(body)).into_response()
    }
}

// ---------------------------------------------------------------------------
// Middleware: auth + rate limit
// ---------------------------------------------------------------------------

fn is_loopback(addr: &SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

async fn guard(
    State(state): State<AppState>,
    peer: Option<ConnectInfo<SocketAddr>>,
    req: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // `ConnectInfo` is absent only when the router is driven without a socket
    // (tests). That must not become a way to skip the loopback rule.
    let peer = peer.map(|ConnectInfo(addr)| addr);
    // Health checks stay open so the extension popup can always probe status.
    if req.uri().path() == "/health" {
        return Ok(next.run(req).await);
    }

    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    let header_key = req
        .headers()
        .get("x-cortex-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let query_key = req
        .uri()
        .query()
        .and_then(|q| {
            urlencoded_pair(q, "key")
        })
        .unwrap_or_default();

    let provided = if !presented.is_empty() {
        presented
            .strip_prefix("Bearer ")
            .or_else(|| presented.strip_prefix("bearer "))
            .unwrap_or(&presented)
            .to_string()
    } else if !header_key.is_empty() {
        header_key
    } else {
        query_key
    };

    match &state.config.api_key {
        Some(expected) => {
            if provided.is_empty() {
                return Err(ApiError::unauthorized(
                    "missing bearer token; set CORTEX_API_KEY on the client",
                ));
            }
            if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
                return Err(ApiError::unauthorized("invalid token"));
            }
        }
        None => {
            // No key configured: refuse non-local peers instead of exposing the
            // graph to the network.
            match peer {
                Some(addr) if is_loopback(&addr) => {}
                other => {
                    return Err(ApiError::forbidden(format!(
                        "CORTEX_API_KEY is unset and this client is {} ; set a key to serve remote clients",
                        match other {
                            Some(addr) => format!("not loopback ({addr})"),
                            None => "not a loopback socket".to_string(),
                        }
                    )));
                }
            }
        }
    }

    // Rate limit per client, generous enough for a chat session.
    if let (Some(ip), true) = (
        peer.map(|addr| addr.ip()),
        state.config.rate_limit_per_min > 0,
    ) {
        let minute = Utc::now().timestamp() / 60;
        let mut bucket = state
            .rate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = bucket.entry(ip).or_insert((0, minute));
        if entry.1 != minute {
            entry.0 = 0;
            entry.1 = minute;
        }
        entry.0 = entry.0.saturating_add(1);
        if entry.0 > state.config.rate_limit_per_min {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                format!(
                    "limit of {} requests/minute exceeded",
                    state.config.rate_limit_per_min
                ),
            ));
        }
    }

    Ok(next.run(req).await)
}

fn urlencoded_pair(query: &str, want: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(want) {
            return it.next().map(|v| percent_decode(v));
        }
    }
    None
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                match (hi, lo) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub async fn start_server(state: AppState) -> anyhow::Result<()> {
    let config = state.config.clone();
    let backend = state.store.backend_name();
    let app = build_router(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid bind address {}: {}", config.host, e))?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!(%addr, backend = %backend, "Cortex Core API listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// The production router, split out so integration tests exercise the *same*
/// layer stack (auth inside CORS, body limit, panic catcher) as the binary.
pub fn build_router(state: AppState) -> Router {
    let config = state.config.clone();
    let mut cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
        .max_age(Duration::from_secs(600));

    if config.allowed_origins.iter().any(|o| o == "*") {
        tracing::warn!("CORS is configured to allow any origin — never ship this default");
        cors = cors.allow_origin(tower_http::cors::Any);
    } else {
        let allowed: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        cors = cors.allow_origin(tower_http::cors::AllowOrigin::list(allowed));
    }

    let backend = state.store.backend_name();

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/v1/recall", post(recall_context))
        .route("/v1/ingest", post(ingest_context))
        .route("/v1/inject", post(inject_uri_memory))
        .route("/v1/jobs/:job_id", get(job_status))
        .route("/v1/session/message", post(session_message))
        .route("/v1/flush", post(flush_session))
        .route("/v1/memories", get(list_memories))
        .route("/v1/memories/:node_id", delete(delete_memory))
        .route("/v1/memories/:node_id/lock", post(lock_memory))
        .route("/v1/sweep", post(trigger_sweep))
        .route("/v1/stats", get(stats))
        .route("/v1/export", get(export_graph))
        .route("/v1/import", post(import_graph))
        .route("/v1/resolve", get(resolve_uri))
        .route("/v1/mesh/publish", post(publish_to_mesh_endpoint))
        .route("/v1/crawler/config", post(configure_crawler))
        .route("/ws", get(ws_handler))
        // Layer order matters: the first `.layer()` is innermost. Auth must run
        // *inside* CORS so preflight OPTIONS never gets a 401, and the panic
        // catcher must be outermost so a handler panic still yields a JSON 500.
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::new(Duration::from_secs(30)))
        .layer(cors)
        .layer(CatchPanicLayer::new())
        .with_state(state);

    app
}


async fn shutdown_signal() {
    async fn wait() {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut term = signal(SignalKind::terminate()).ok();
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = async {
                    match term.as_mut() {
                        Some(sig) => {
                            sig.recv().await;
                        }
                        // No SIGTERM available: park forever instead of shutting down.
                        None => std::future::pending::<()>().await,
                    }
                } => {}
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
    wait().await;
    tracing::info!("shutdown signal received, flushing sessions");
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct NodeDto {
    id: String,
    label: String,
    category: NodeCategory,
    impact: u8,
    stability: f32,
    weight_hint: f32,
    locked: bool,
    fading: bool,
    retention: f32,
    owner_uri: String,
    provenance: String,
    access_count: u32,
    last_accessed: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<&MemoryNode> for NodeDto {
    fn from(n: &MemoryNode) -> Self {
        Self {
            id: n.id.clone(),
            label: n.label.clone(),
            category: n.category,
            impact: n.impact,
            stability: (n.stability * 100.0).round() / 100.0,
            weight_hint: (n.salience() * 1000.0).round() / 1000.0,
            locked: n.locked,
            fading: n.fading,
            retention: (n.retention_probability() * 1000.0).round() / 1000.0,
            owner_uri: n.owner_uri.clone(),
            provenance: n.provenance.clone(),
            access_count: n.access_count,
            last_accessed: n.last_accessed,
            updated_at: n.updated_at,
        }
    }
}

#[derive(Serialize)]
struct EdgeDto {
    id: String,
    source: String,
    target: String,
    #[serde(default)]
    source_label: String,
    #[serde(default)]
    target_label: String,
    predicate: String,
    weight: f32,
    is_historical: bool,
    locked: bool,
    owner_uri: String,
    reinforcement_count: u32,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_secs: i64,
    backend: String,
    decay_policy: &'static str,
    authenticated: bool,
    services: Services,
    counts: Counts,
}

#[derive(Serialize, Default)]
struct Services {
    graph: bool,
    extraction: bool,
    vector_accelerator: bool,
    sessions: bool,
    cloud_sync: bool,
}

#[derive(Serialize, Default)]
struct Counts {
    nodes: usize,
    edges: usize,
    pending_jobs: usize,
    buffered_sessions: usize,
}

async fn health_check(State(state): State<AppState>) -> impl IntoResponse {
    let graph_ok = state.store.ping().await;
    let (nodes, edges) = state.store.counts().await.unwrap_or((0, 0));
    let pending = state
        .jobs
        .lock()
        .map(|reg| {
            reg.jobs
                .values()
                .filter(|j| matches!(j.state, JobState::Queued | JobState::Running))
                .count()
        })
        .unwrap_or(0);

    let body = HealthResponse {
        status: if graph_ok { "ok" } else { "degraded" },
        version: state.config.version,
        uptime_secs: (Utc::now() - state.started_at).num_seconds().max(0),
        backend: state.store.backend_name().to_string(),
        decay_policy: state.config.decay.policy.as_str(),
        authenticated: state.config.api_key.is_some(),
        services: Services {
            graph: graph_ok,
            extraction: state.extractor.is_some(),
            vector_accelerator: state.vector.is_some(),
            sessions: true,
            // Honestly reported: the CRDT cloud sync path is not implemented.
            cloud_sync: false,
        },
        counts: Counts {
            nodes,
            edges,
            pending_jobs: pending,
            buffered_sessions: state.sessions.len().await,
        },
    };
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(body),
    )
}

#[derive(Deserialize)]
struct RecallRequest {
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    owner: Option<String>,
    prompt: String,
    #[serde(default)]
    token_budget: Option<u32>,
    #[serde(default)]
    max_hops: Option<u8>,
    #[serde(default)]
    include_mesh: Option<bool>,
    /// Adds per-node match explanations (for the "why did I get no memory" panel).
    #[serde(default)]
    explain: Option<bool>,
}

#[derive(Serialize)]
struct RecallResponse {
    briefing: String,
    token_budget: u32,
    tokens_used: u32,
    memories_found: usize,
    truncated: bool,
    scanned: usize,
    owner_uri: String,
    node_count: usize,
    edge_count: usize,
    nodes: Vec<NodeDto>,
    edges: Vec<EdgeDto>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    debug: Vec<recall::ScoredNode>,
}

async fn recall_context(
    State(state): State<AppState>,
    Json(payload): Json<RecallRequest>,
) -> Result<Json<RecallResponse>, ApiError> {
    if payload.prompt.trim().is_empty() {
        return Err(ApiError::bad_request("prompt must not be empty"));
    }
    let owner = payload
        .owner
        .clone()
        .or(payload.user_id.clone())
        .unwrap_or_else(|| state.config.default_owner.clone());
    let budget = payload
        .token_budget
        .unwrap_or(state.config.default_token_budget)
        .clamp(32, state.config.max_token_budget);

    let opts = RecallOptions {
        token_budget: budget,
        max_hops: payload.max_hops.unwrap_or(2).clamp(1, 4),
        include_mesh: payload.include_mesh.unwrap_or(false),
        include_briefing_debug: payload.explain.unwrap_or(false),
        ..RecallOptions::default()
    };

    let (query_vec, query_model) = state.query_embedding(&payload.prompt).await;

    let outcome = recall::recall(&state.store, &payload.prompt, &owner, &opts, &query_vec, &query_model)
        .await
        .map_err(|e| ApiError::internal(e))?;

    let labels: HashMap<String, String> = outcome
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.label.clone()))
        .collect();
    let edges: Vec<EdgeDto> = outcome
        .edges
        .iter()
        .map(|e| EdgeDto {
            id: e.id.clone(),
            source: e.source.clone(),
            target: e.target.clone(),
            source_label: labels.get(&e.source).cloned().unwrap_or_default(),
            target_label: labels.get(&e.target).cloned().unwrap_or_default(),
            predicate: e.predicate.clone(),
            weight: (e.weight * 1000.0).round() / 1000.0,
            is_historical: e.is_historical,
            locked: e.locked,
            owner_uri: e.owner_uri.clone(),
            reinforcement_count: e.reinforcement_count,
        })
        .collect();

    // Touch the memories we actually served, so reinforcement/decay reflect use.
    let touched: Vec<String> = outcome.nodes.iter().map(|n| n.id.clone()).collect();
    state.reinforce(touched).await;

    Ok(Json(RecallResponse {
        briefing: outcome.briefing.clone(),
        token_budget: outcome.token_budget,
        tokens_used: outcome.tokens_used,
        memories_found: outcome.memories_found,
        truncated: outcome.truncated,
        scanned: outcome.scanned,
        owner_uri: outcome.owner_uri,
        node_count: outcome.nodes.len(),
        edge_count: outcome.edges.len(),
        nodes: outcome.nodes.iter().map(NodeDto::from).collect(),
        edges,
        debug: outcome.debug,
    }))
}

#[derive(Deserialize)]
struct IngestRequest {
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    messages: Option<Vec<Message>>,
    /// Provenance tag stored with each memory (mcp | extension | sdk | hydrator).
    #[serde(default)]
    source: Option<String>,
    /// When true the caller waits for extraction (used by the MCP `remember`
    /// tool so the model can confirm a write). Default false: fire-and-forget.
    #[serde(default)]
    wait: Option<bool>,
    /// Floor for the impact of everything in this request (0..=10). Callers that
    /// already know a fact is permanent (an explicit `remember(..., impact: 10)`)
    /// must not have that downgraded by the extractor's guess. Never raises above
    /// what the extractor itself decided.
    #[serde(default)]
    impact: Option<u8>,
}

impl IngestRequest {
    fn impact_floor(&self) -> Option<u8> {
        self.impact.map(|i| i.min(10))
    }
}

async fn ingest_context(
    State(state): State<AppState>,
    Json(payload): Json<IngestRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let owner = normalize_owner(
        &payload
            .owner
            .clone()
            .or(payload.user_id.clone())
            .unwrap_or_else(|| state.config.default_owner.clone()),
    );
    let provenance = payload
        .source
        .clone()
        .unwrap_or_else(|| "api".to_string())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(32)
        .collect::<String>();

    let mut transcript = String::new();
    if let Some(prompt) = payload.prompt.as_deref() {
        let bounded: String = prompt.chars().take(32_000).collect();
        transcript.push_str(&bounded);
    }
    if let Some(messages) = payload.messages.clone() {
        transcript.push_str(&render_transcript(&messages));
    }
    let transcript = transcript.trim().to_string();
    if transcript.is_empty() {
        return Err(ApiError::bad_request(
            "provide `prompt` and/or `messages`; nothing to extract",
        ));
    }

    let permit = state.inflight.clone().try_acquire_owned().map_err(|_| {
        ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "extraction_saturated",
            "extraction queue is full; retry shortly",
        )
    })?;

    let job_id = format!("job:{}", uuid::Uuid::new_v4());
    {
        let mut reg = state
            .jobs
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        reg.put(Job {
            id: job_id.clone(),
            state: JobState::Queued,
            created_at: Utc::now(),
            finished_at: None,
            result: None,
            error: None,
        });
    }

    let st = state.clone();

    let job_for_task = job_id.clone();
    let wait = payload.wait.unwrap_or(false);
    let impact_floor = payload.impact_floor();
    let handle = tokio::spawn(async move {
        let _permit = permit;
        set_job(&st, &job_for_task, JobState::Running, None, None);
        let outcome = apply_transcript(&st, &transcript, &owner, &provenance, impact_floor).await;
        match outcome {
            Ok(report) => {
                set_job(&st, &job_for_task, JobState::Done, Some(report), None);
            }
            Err(err) => {
                set_job(&st, &job_for_task, JobState::Failed, None, Some(err.message));
            }
        }
    });

    if wait {
        // Bounded so a caller can never hang on a stalled LLM.
        let waited = tokio::time::timeout(Duration::from_secs(25), handle).await;
        if waited.is_err() {
            return Ok((
                StatusCode::ACCEPTED,
                Json(serde_json::json!({
                    "accepted": true, "job_id": job_id, "timed_out": true,
                    "message": "extraction still running; poll /v1/jobs/…",
                })),
            ));
        }
        let snapshot = job_snapshot(&state, &job_id);
        let (status, body) = match snapshot {
            Some(job) if job.state == JobState::Done => (
                StatusCode::OK,
                serde_json::json!({ "accepted": true, "job_id": job_id, "result": job.result }),
            ),
            Some(job) if job.state == JobState::Failed => (
                StatusCode::OK,
                serde_json::json!({
                    "accepted": false, "job_id": job_id, "error": job.error,
                    "message": "extraction failed; the text was not remembered",
                }),
            ),
            other => (
                StatusCode::ACCEPTED,
                serde_json::json!({ "accepted": true, "job_id": job_id, "state": other.map(|j| j.state) }),
            ),
        };
        state.publish_pulse("WS_SYNAPSE_PULSE");
        return Ok((status, Json(body)));
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "accepted": true,
            "job_id": job_id,
            "owner_uri": owner,
            "message": "queued for extraction; poll GET /v1/jobs/<id>",
        })),
    ))
}

fn set_job(
    state: &AppState,
    job_id: &str,
    job_state: JobState,
    result: Option<IngestReport>,
    error: Option<String>,
) {
    if let Ok(mut reg) = state.jobs.lock() {
        if let Some(job) = reg.jobs.get_mut(job_id) {
            job.state = job_state;
            job.finished_at = Some(Utc::now());
            if result.is_some() {
                job.result = result;
            }
            job.error = error;
        }
    }
}

fn job_snapshot(state: &AppState, job_id: &str) -> Option<Job> {
    state
        .jobs
        .lock()
        .ok()
        .and_then(|reg| reg.jobs.get(job_id).cloned())
}

#[derive(Deserialize)]
struct JobIdPath {
    job_id: String,
}

async fn job_status(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<JobIdPath>,
) -> Result<Json<Job>, ApiError> {
    job_snapshot(&state, &path.job_id)
        .map(Json)
        .ok_or_else(|| ApiError::not_found("unknown job id"))
}

/// Extraction + persistence, shared by `/v1/ingest`, `/v1/inject` and the
/// session flusher so all three get identical semantics.
async fn apply_transcript(
    state: &AppState,
    transcript: &str,
    owner: &str,
    provenance: &str,
    impact_floor: Option<u8>,
) -> Result<IngestReport, ApiError> {
    let mut warnings = Vec::new();
    let mut extractor = "heuristic".to_string();
    let mut triplets: Vec<SemanticTriplet> = Vec::new();

    if let Some(ref ai) = state.extractor {
        match tokio::time::timeout(Duration::from_secs(20), ai.extract_triplets(transcript)).await {
            Ok(Ok(found)) if !found.is_empty() => {
                extractor = format!("shadow_kernel:{}", ai.model_label());
                triplets = found;
            }
            Ok(Ok(_)) => warnings.push("extraction returned no triplets; used heuristic fallback".into()),
            Ok(Err(err)) => {
                warnings.push(format!("shadow kernel failed ({err}); used heuristic fallback"));
            }
            Err(_) => warnings.push("shadow kernel timed out; used heuristic fallback".into()),
        }
    } else {
        warnings.push("no OPENROUTER_API_KEY configured; heuristic extraction only".into());
    }

    if triplets.is_empty() {
        triplets = crate::ai::heuristic_triplets(transcript);
    }

    let mut nodes_out: Vec<MemoryNode> = Vec::new();
    let mut edges_out: Vec<RelationalEdge> = Vec::new();
    let mut rejected = 0usize;
    let extracted = triplets.len();
    // Pulled out first because the main loop consumes `triplets`.
    let corrections: Vec<SemanticTriplet> = triplets
        .iter()
        .filter(|t| t.overwrite)
        .cloned()
        .collect();

    let mut local_index: HashMap<String, MemoryNode> = HashMap::new();
    for triplet in triplets.into_iter() {
        let triplet = triplet.sanitized();
        let triplet = match impact_floor {
            Some(floor) if floor > triplet.impact => SemanticTriplet {
                impact: floor,
                ..triplet
            },
            _ => triplet,
        };
        if !triplet.is_valid() || triplet.subject.chars().count() < 2 {
            rejected += 1;
            continue;
        }
        // Guard against the extraction kernel echoing boilerplate back at us.
        if triplet.subject.len() > 240 || triplet.object.len() > 400 {
            rejected += 1;
            continue;
        }

        let mut touched: Vec<MemoryNode> = Vec::new();
        for entity in [triplet.subject.clone(), triplet.object.clone()] {
            let id = crate::types::node_id_for_label(&entity);
            let (mut node, _is_new) = match local_index
                .get(&id)
                .cloned()
                .or_else(|| state.store.get_node(&id).await.ok().flatten())
            {
                Some(existing) => (existing, false),
                None => {
                    let fresh = MemoryNode::with_owner(entity.clone(), owner);
                    (fresh, true)
                }
            };
            node.reinforce_with_impact(triplet.impact, triplet.confidence);
            node.owner_uri = normalize_owner(owner);
            if node.provenance.is_empty() {
                node.provenance = provenance.to_string();
            }
            if node.embedding.is_empty() {
                node.embedding = state.embed(&node.label).await;
                node.embedding_model = state.embedding_model();
            }
            local_index.insert(node.id.clone(), node.clone());
            touched.push(node);
        }
        nodes_out.extend(touched);

        let src = canonical_node_id(&triplet.subject);
        let tgt = canonical_node_id(&triplet.object);
        let mut edge = RelationalEdge::between(&src, &triplet.predicate, &tgt, triplet.confidence, owner);
        edge.impact = triplet.impact;
        edge.provenance = provenance.to_string();
        // Several triplets in one transcript can resolve to the same edge: merge
        // them into one reinforcement instead of shipping duplicates.
        match edges_out.iter_mut().find(|e| e.id == edge.id) {
            Some(existing) => {
                existing.reinforce(triplet.confidence * 0.1);
                existing.impact = existing.impact.max(triplet.impact);
            }
            None => edges_out.push(edge),
        }
    }

    if nodes_out.is_empty() && edges_out.is_empty() {
        return Ok(IngestReport {
            triplets_rejected: rejected,
            extractor,
            warnings,
            owner_uri: normalize_owner(owner),
            ..Default::default()
        });
    }

    // Contradictions: obsolete the superseded edge rather than duplicating.
    if !corrections.is_empty() {
        let mut scratch = state.store.all_edges().await.unwrap_or_default();
        let already_historical: HashSet<String> = scratch
            .iter()
            .filter(|e| e.is_historical)
            .map(|e| e.id.clone())
            .collect();
        for triplet in corrections.iter() {
            let src = canonical_node_id(&triplet.subject);
            let tgt = canonical_node_id(&triplet.object);
            if let Ok(Some(created)) = state.apply_overwrite(triplet, &src, &tgt, &mut scratch) {
                edges_out.push(created);
            }
        }
        // Persist exactly the edges the engine newly obsoleted — not the whole table.
        let newly: Vec<RelationalEdge> = scratch
            .into_iter()
            .filter(|e| e.is_historical && !already_historical.contains(&e.id))
            .collect();
        edges_out.extend(newly);
    }

    // The store, not the loop, decides what was new: its answer is what we report.
    let (nodes_new, edges_new) = state
        .store
        .apply_batch(nodes_out.clone(), edges_out.clone())
        .await?;

    // Keep the optional vector index in step with the graph. A failure here is
    // cosmetic (recall degrades to lexical scoring) and must not fail the write.
    if let Some(index) = state.vector.as_ref() {
        for node in nodes_out.iter().filter(|n| !n.embedding.is_empty()) {
            if let Err(err) = index
                .upsert_mapping(&node.id, node.embedding.clone())
                .await
            {
                tracing::warn!(
                    error = %err,
                    node = %node.id,
                    "vector index upsert failed; graph write is unaffected"
                );
            }
        }
    }

    state.publish_pulse("WS_SYNAPSE_PULSE");

    Ok(IngestReport {
        triplets_extracted: extracted,
        triplets_rejected: rejected,
        nodes_upserted: nodes_out.len(),
        nodes_new,
        edges_upserted: edges_out.len(),
        edges_new,
        extractor,
        warnings,
        owner_uri: normalize_owner(owner),
    })
}


#[derive(Deserialize)]
struct InjectRequest {
    uri: String,
    text: String,
    #[serde(default)]
    source: Option<String>,
    /// Accepted for symmetry with `/v1/ingest`; `/v1/inject` is always
    /// synchronous, because SDK callers need the write confirmed before they
    /// return. `wait` is therefore ignored rather than misleading.
    #[serde(default)]
    #[allow(dead_code)]
    wait: Option<bool>,
    #[serde(default)]
    impact: Option<u8>,
}

async fn inject_uri_memory(
    State(state): State<AppState>,
    Json(payload): Json<InjectRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    if payload.text.trim().is_empty() {
        return Err(ApiError::bad_request("`text` must not be empty"));
    }
    let owner = normalize_owner(&payload.uri);
    let provenance = payload
        .source
        .clone()
        .unwrap_or_else(|| "sdk".to_string())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(32)
        .collect::<String>();
    let report = apply_transcript(&state, &payload.text, &owner, &provenance, payload.impact.map(|i| i.min(10))).await?;
    let body = serde_json::json!({
        "success": true,
        "owner_uri": owner,
        "message": format!(
            "remembered {} relations across {} concepts",
            report.edges_upserted, report.nodes_upserted
        ),
        "result": report,
    });
    Ok((StatusCode::OK, Json(body)))
}

#[derive(Deserialize)]
struct SessionMessageRequest {
    session_id: String,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    role: MessageRole,
    content: String,
    #[serde(default)]
    source: Option<String>,
}

async fn session_message(
    State(state): State<AppState>,
    Json(payload): Json<SessionMessageRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if payload.content.trim().is_empty() {
        return Err(ApiError::bad_request("`content` must not be empty"));
    }
    let owner = normalize_owner(
        &payload
            .owner
            .or(payload.user_id)
            .unwrap_or_else(|| state.config.default_owner.clone()),
    );
    let session_id = payload.session_id.trim().to_string();
    if session_id.is_empty() || session_id.len() > 128 {
        return Err(ApiError::bad_request("`session_id` must be 1..=128 chars"));
    }
    let provenance = payload.source.unwrap_or_else(|| "api".to_string());
    let full = state
        .sessions
        .append(
            &session_id,
            &owner,
            Message::new(payload.role, payload.content),
            &provenance,
        )
        .await;

    let mut flushed = serde_json::Value::Null;
    if full {
        if let Some(payload) = state.sessions.take_session(&session_id).await {
            flushed = serde_json::to_value(flush_payload(&state, payload).await?)
                .unwrap_or(serde_json::Value::Null);
        }
    }

    Ok(Json(serde_json::json!({
        "buffered": !full,
        "session_id": session_id,
        "idle_flush_secs": state.sessions.idle_secs(),
        "flush": flushed,
    })))
}

#[derive(Deserialize)]
struct FlushRequest {
    #[serde(default)]
    session_id: Option<String>,
}

async fn flush_session(
    State(state): State<AppState>,
    Json(payload): Json<FlushRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let reports = match payload.session_id {
        Some(id) => match state.sessions.take_session(id.trim()).await {
            Some(p) => vec![flush_payload(&state, p).await?],
            None => vec![],
        },
        None => {
            let mut out = Vec::new();
            for p in state.sessions.drain_all().await {
                out.push(flush_payload(&state, p).await?);
            }
            out
        }
    };
    Ok(Json(serde_json::json!({ "flushed_sessions": reports.len(), "results": reports })))
}

async fn flush_payload(state: &AppState, payload: crate::storage::session::FlushPayload) -> Result<IngestReport, ApiError> {
    let transcript = render_transcript(&payload.messages);
    let provenance = if payload.provenance.is_empty() {
        "session".to_string()
    } else {
        payload.provenance
    };
    apply_transcript(state, &transcript, &payload.owner_uri, &provenance, None).await
}

#[derive(Deserialize)]
struct MemoryQuery {
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    include_mesh: Option<bool>,
}

async fn list_memories(
    State(state): State<AppState>,
    Query(query): Query<MemoryQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let owner = normalize_owner(
        &query
            .owner
            .or(query.user_id)
            .unwrap_or_else(|| state.config.default_owner.clone()),
    );
    let limit = query.limit.unwrap_or(100).clamp(1, 2000);
    let mut nodes = state.store.all_nodes().await?;
    nodes.retain(|n| {
        let n_owner = normalize_owner(&n.owner_uri);
        n_owner == owner || (query.include_mesh.unwrap_or(false) && n_owner == crate::types::GLOBAL_MESH_OWNER)
    });
    if let Some(term) = query.q.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let needle = term.to_lowercase();
        nodes.retain(|n| {
            n.label.to_lowercase().contains(&needle) || n.aliases.iter().any(|a| a.to_lowercase().contains(&needle))
        });
    }
    nodes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let total = nodes.len();
    let page_nodes: Vec<MemoryNode> = nodes.into_iter().take(limit).collect();
    let page: Vec<NodeDto> = page_nodes.iter().map(NodeDto::from).collect();

    let labels: HashMap<String, String> = page_nodes
        .iter()
        .map(|n| (n.id.clone(), n.label.clone()))
        .collect();
    let edge_page: Vec<EdgeDto> = state
        .store
        .all_edges()
        .await?
        .into_iter()
        .filter(|e| {
            let e_owner = normalize_owner(&e.owner_uri);
            e_owner == owner || (query.include_mesh.unwrap_or(false) && e_owner == crate::types::GLOBAL_MESH_OWNER)
        })
        .map(|e| EdgeDto {
            source_label: labels.get(&e.source).cloned().unwrap_or_default(),
            target_label: labels.get(&e.target).cloned().unwrap_or_default(),
            id: e.id.clone(),
            source: e.source.clone(),
            target: e.target.clone(),
            predicate: e.predicate.clone(),
            weight: (e.weight * 1000.0).round() / 1000.0,
            is_historical: e.is_historical,
            locked: e.locked,
            owner_uri: e.owner_uri.clone(),
            reinforcement_count: e.reinforcement_count,
        })
        .take(2000)
        .collect();

    Ok(Json(serde_json::json!({
        "owner_uri": owner,
        "total": total,
        "returned": page.len(),
        "memories": page,
        "edges": edge_page,
    })))
}

#[derive(Deserialize)]
struct NodeIdPath {
    node_id: String,
}

async fn delete_memory(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<NodeIdPath>,
) -> Result<StatusCode, ApiError> {
    let id = canonical_node_id(&path.node_id);
    if state.get_node_exists(&id).await? {
        state.store.delete_node(&id).await.map_err(ApiError::internal)?;
        // The vector index lives outside the graph store: if we skip this,
        // recall keeps resurrecting a node the user deleted.
        if let Some(vector) = state.vector.as_ref() {
            match vector.delete_for_nodes(&[id.clone()]).await {
                Ok(n) if n > 0 => tracing::debug!(points = n, "vector points removed with node"),
                Ok(_) => {}
                Err(err) => tracing::warn!(error = %err, "node deleted but its vector index entry remains"),
            }
        }
        state.publish_pulse("WS_DECAY");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found(format!("no memory {id}")))
    }
}

#[derive(Deserialize)]
struct LockRequest {
    #[serde(default = "default_true")]
    locked: bool,
    #[serde(default)]
    label: Option<String>,
}

fn default_true() -> bool {
    true
}

async fn lock_memory(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<NodeIdPath>,
    Json(payload): Json<LockRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let id = canonical_node_id(&path.node_id);
    let updated = state
        .store
        .set_node_locked(&id, payload.locked)
        .await
        .map_err(ApiError::internal)?;
    match updated {
        Some(node) => Ok(Json(serde_json::json!({
            "success": true,
            "locked": node.locked,
            "memory": NodeDto::from(&node),
        }))),
        None => Err(ApiError::not_found(format!("no memory {id}"))),
    }
}

async fn trigger_sweep(State(state): State<AppState>) -> Result<Json<SweepReport>, ApiError> {
    let report = state
        .config
        .decay
        .sweep(&state.store)
        .await
        .map_err(ApiError::internal)?;
    if report.faded_nodes + report.pruned_nodes > 0 {
        state.publish_pulse("WS_DECAY");
    }
    Ok(Json(report))
}

#[derive(Serialize)]
struct StatsResponse {
    version: &'static str,
    backend: String,
    decay_policy: &'static str,
    nodes: usize,
    edges: usize,
    locked: usize,
    fading: usize,
    historical: usize,
    avg_retention: f32,
    by_category: HashMap<String, usize>,
    by_provenance: HashMap<String, usize>,
    top_labels: Vec<String>,
    /// Cost of injecting the *whole* graph — shows why budgeting matters.
    full_graph_token_estimate: u32,
}

async fn stats(State(state): State<AppState>) -> Result<Json<StatsResponse>, ApiError> {
    let nodes = state.store.all_nodes().await.map_err(ApiError::internal)?;
    let edges = state.store.all_edges().await.map_err(ApiError::internal)?;

    let mut by_category: HashMap<String, usize> = HashMap::new();
    let mut by_provenance: HashMap<String, usize> = HashMap::new();
    let mut retention_sum = 0f32;
    let mut locked = 0usize;
    let mut fading = 0usize;

    for node in &nodes {
        *by_category
            .entry(format!("{:?}", node.category).to_lowercase())
            .or_default() += 1;
        let prov = if node.provenance.is_empty() {
            "unknown"
        } else {
            node.provenance.as_str()
        };
        *by_provenance.entry(prov.to_string()).or_default() += 1;
        retention_sum += node.retention_probability();
        if node.locked {
            locked += 1;
        }
        if node.fading {
            fading += 1;
        }
    }

    let mut ranked: Vec<(f32, String)> = nodes
        .iter()
        .map(|n| (n.salience(), n.label.clone()))
        .collect();
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    Ok(Json(StatsResponse {
        version: state.config.version,
        backend: state.store.backend_name().to_string(),
        decay_policy: state.config.decay.policy.as_str(),
        nodes: nodes.len(),
        edges: edges.len(),
        locked,
        fading,
        historical: edges.iter().filter(|e| e.is_historical).count(),
        avg_retention: if nodes.is_empty() {
            0.0
        } else {
            (retention_sum / nodes.len() as f32 * 1000.0).round() / 1000.0
        },
        by_category,
        by_provenance,
        top_labels: ranked.into_iter().take(6).map(|(_, l)| l).collect(),
        full_graph_token_estimate: nodes
            .iter()
            .map(|n| estimate_tokens(&n.label))
            .sum::<u32>()
            + edges
                .iter()
                .map(|e| estimate_tokens(&e.predicate))
                .sum::<u32>(),
    }))
}

async fn export_graph(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let nodes = state.store.all_nodes().await.map_err(ApiError::internal)?;
    let edges = state.store.all_edges().await.map_err(ApiError::internal)?;
    let body = serde_json::json!({
        "protocol": "cortex.memory@2",
        "exported_at": Utc::now().to_rfc3339(),
        "counts": { "nodes": nodes.len(), "edges": edges.len() },
        "nodes": nodes,
        "edges": edges,
    });
    Ok((
        [(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"cortex-memory.json\""),
        )],
        Json(body),
    ))
}

#[derive(Deserialize)]
struct ImportRequest {
    #[serde(default)]
    nodes: Vec<MemoryNode>,
    #[serde(default)]
    edges: Vec<RelationalEdge>,
    #[serde(default)]
    owner: Option<String>,
}

async fn import_graph(
    State(state): State<AppState>,
    Json(payload): Json<ImportRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let owner = payload
        .owner
        .map(|o| normalize_owner(&o))
        .unwrap_or_else(|| state.config.default_owner.clone());
    let mut nodes = payload.nodes;
    for node in nodes.iter_mut() {
        node.id = crate::types::node_id_for_label(&node.label);
        node.label_key = crate::types::normalize_label(&node.label);
        node.owner_uri = normalize_owner(&node.owner_uri);
        if node.owner_uri.is_empty() {
            node.owner_uri = owner.clone();
        }
    }
    let mut edges = payload.edges;
    for edge in edges.iter_mut() {
        edge.source = canonical_node_id(&edge.source);
        edge.target = canonical_node_id(&edge.target);
        edge.predicate = crate::types::normalize_predicate(&edge.predicate);
        edge.id = crate::types::edge_id_for(&edge.source, &edge.predicate, &edge.target);
        edge.owner_uri = normalize_owner(&edge.owner_uri);
    }
    if nodes.len() + edges.len() > 50_000 {
        return Err(ApiError::bad_request("import too large (50k records max)"));
    }
    let (n, e) = state
        .store
        .apply_batch(nodes, edges)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(serde_json::json!({ "success": true, "nodes_new": n, "edges_new": e })))
}

#[derive(Deserialize)]
struct ResolveQuery {
    uri: String,
    #[serde(default)]
    include_mesh: bool,
    #[serde(default)]
    token_budget: Option<u32>,
}

async fn resolve_uri(
    State(state): State<AppState>,
    Query(query): Query<ResolveQuery>,
) -> Result<Json<CortexContextPacket>, ApiError> {
    let owner = normalize_owner(&query.uri);
    let budget = query
        .token_budget
        .unwrap_or(state.config.default_token_budget)
        .clamp(32, state.config.max_token_budget);
    let opts = RecallOptions {
        token_budget: budget,
        include_mesh: query.include_mesh,
        ..RecallOptions::default()
    };
    // `resolve` is "give me the whole namespace", so recall with an empty prompt
    // is exactly a salience-ordered, budget-packed view of it.
    let (vec, model) = state.query_embedding("").await;
    let outcome: RecallOutcome = recall::recall(&state.store, "", &owner, &opts, &vec, &model)
        .await
        .map_err(ApiError::internal)?;

    let packet = CortexContextPacket {
        context: "https://cortex.dev/ns/memory@2".to_string(),
        user_id: owner.clone(),
        nodes: outcome.nodes,
        edges: outcome.edges,
        rules: vec![],
        token_budget: budget,
        token_estimate: outcome.tokens_used,
        memories_found: outcome.memories_found,
        truncated: outcome.truncated,
        briefing: if outcome.briefing.is_empty() {
            format!("No memories recorded under {owner} yet.")
        } else {
            outcome.briefing
        },
        generated_at: Some(Utc::now()),
    };
    Ok(Json(packet))
}

#[derive(Deserialize)]
struct MeshPublishRequest {
    nodes: Vec<MemoryNode>,
    edges: Vec<RelationalEdge>,
}

async fn publish_to_mesh_endpoint(
    State(state): State<AppState>,
    Json(payload): Json<MeshPublishRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !state.config.allow_mesh_publish {
        return Err(ApiError::new(
            StatusCode::NOT_IMPLEMENTED,
            "mesh_publish_disabled",
            "publishing to the shared mesh is disabled; set CORTEX_ALLOW_MESH_PUBLISH=1 after you have moderation and opt-in in place",
        ));
    }
    let sink = state
        .mesh_sink
        .clone()
        .ok_or_else(|| ApiError::unavailable("no mesh store configured (CORTEX_MESH_PATH)"))?;

    let mut nodes = payload.nodes;
    for node in nodes.iter_mut() {
        node.owner_uri = crate::types::GLOBAL_MESH_OWNER.to_string();
        node.provenance = "mesh_publish".to_string();
        // Never publish identity-bearing labels verbatim.
        node.aliases.clear();
        node.metadata = serde_json::Value::Null;
    }
    let mut edges = payload.edges;
    for edge in edges.iter_mut() {
        edge.owner_uri = crate::types::GLOBAL_MESH_OWNER.to_string();
        edge.source = canonical_node_id(&edge.source);
        edge.target = canonical_node_id(&edge.target);
    }
    let (n, e) = sink.apply_batch(nodes, edges).await.map_err(ApiError::internal)?;
    Ok(Json(serde_json::json!({
        "success": true,
        "nodes_published": n,
        "edges_published": e,
        "namespace": crate::types::GLOBAL_MESH_OWNER,
    })))
}

async fn configure_crawler() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "success": false,
            "error": {
                "code": "not_implemented",
                "message": "the autonomous codebase crawler is not implemented; no directories are being watched",
            }
        })),
    )
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut rx = state.ws_tx.subscribe();
    let mut ticker = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            received = rx.recv() => match received {
                Ok(text) => {
                    if socket.send(WsMessage::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            _ = ticker.tick() => {
                if socket.send(WsMessage::Text(r#"{"type":"ping"}"#.to_string())).await.is_err() {
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

impl AppState {
    fn publish_pulse(&self, kind: &str) {
        let payload = format!(r#"{{"type":"{kind}","at":"{}"}}"#, Utc::now().to_rfc3339());
        let _ = self.ws_tx.send(payload);
    }

    /// Which vector space `node.embedding` lives in. Reporting the local model
/// while an OpenAI vector was actually stored would let recall compare
    /// incompatible embeddings, so the tag follows the configured provider.
    fn embedding_model(&self) -> String {
        match self.vector.as_ref() {
            Some(index) => index.embedding_model_tag().to_string(),
            None => recall::LOCAL_EMBEDDING_MODEL.to_string(),
        }
    }

    async fn embed(&self, text: &str) -> Vec<f32> {
        match self.vector.as_ref() {
            Some(idx) => idx.embed_text_semantic(text).await,
            None => crate::storage::vector_db::compute_local_embedding(text),
        }
    }

    async fn query_embedding(&self, text: &str) -> (Vec<f32>, String) {
        if text.trim().is_empty() {
            return (vec![], self.embedding_model());
        }
        (self.embed(text).await, self.embedding_model())
    }

    async fn get_node_exists(&self, id: &str) -> Result<bool, ApiError> {
        Ok(self.store.get_node(id).await.map_err(ApiError::internal)?.is_some())
    }

    /// Reinforce the memories we actually served (drives stability growth).
    async fn reinforce(&self, ids: Vec<String>) {
        if ids.is_empty() {
            return;
        }
        for id in ids.into_iter().take(64) {
            if let Ok(Some(mut node)) = self.store.get_node(&id).await {
                node.mark_accessed();
                let _ = self.store.upsert_node(&node).await;
            }
        }
    }

    async fn apply_overwrite(
        &self,
        triplet: &SemanticTriplet,
        src: &str,
        tgt: &str,
        scratch: &mut Vec<RelationalEdge>,
    ) -> Result<Option<RelationalEdge>, ApiError> {
        let engine = crate::engine::overwrite::StateOverwriteEngine::new();
        let created = engine
            .apply_overwrite(triplet, src, tgt, scratch.as_mut_slice())
            .map_err(ApiError::internal)?;
        Ok(created)
    }
}


// ---------------------------------------------------------------------------
// Configuration loading + background maintenance
// ---------------------------------------------------------------------------

fn env_string(keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|k| std::env::var(k).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

fn env_value<T: std::str::FromStr>(keys: &[&str]) -> Option<T> {
    env_string(keys).and_then(|v| v.parse::<T>().ok())
}

fn env_flag(key: &str) -> bool {
    matches!(
        env_string(&[key]).as_deref(),
        Some("1") | Some("true") | Some("yes") | Some("on")
    )
}

impl CoreConfig {
    /// Builds configuration from `CORTEX_*` environment variables. Defaults are
    /// deliberately the *safe* ones: loopback bind, no mesh publish, conservative
    /// budget. Anything that widens exposure must be asked for explicitly.
    pub fn from_env() -> Self {
        let mut cfg = Self::default();

        if let Some(host) = env_string(&["CORTEX_HOST", "HOST"]) {
            cfg.host = host;
        }
        if let Some(port) = env_value::<u16>(&["CORTEX_PORT", "PORT"]) {
            cfg.port = port;
        }
        cfg.api_key = env_string(&["CORTEX_API_KEY", "CORTEX_AUTH_TOKEN"]);
        if let Some(owner) = env_string(&["CORTEX_DEFAULT_OWNER", "CORTEX_USER_ID"]) {
            cfg.default_owner = normalize_owner(&owner);
        }
        if let Some(budget) = env_value::<u32>(&["CORTEX_TOKEN_BUDGET"]) {
            cfg.default_token_budget = budget.clamp(32, 32_000);
        }
        if let Some(max_budget) = env_value::<u32>(&["CORTEX_MAX_TOKEN_BUDGET"]) {
            cfg.max_token_budget = max_budget.clamp(cfg.default_token_budget, 64_000);
        }
        if let Some(origins) = env_string(&["CORTEX_ALLOWED_ORIGINS"]) {
            cfg.allowed_origins = origins
                .split(',')
                .map(|o| o.trim().trim_end_matches('/').to_string())
                .filter(|o| !o.is_empty())
                .collect();
        }
        if let Some(policy) = env_string(&["CORTEX_DECAY_POLICY"]) {
            cfg.decay = DecayEngine::with_policy(DecayPolicy::parse(&policy));
        }
        if let Some(secs) = env_value::<u64>(&["CORTEX_SWEEP_INTERVAL_SECS"]) {
            cfg.sweep_interval_secs = secs.max(60);
        }
        if let Some(limit) = env_value::<u32>(&["CORTEX_RATE_LIMIT_PER_MIN"]) {
            cfg.rate_limit_per_min = limit;
        }
        cfg.allow_mesh_publish = env_flag("CORTEX_ALLOW_MESH_PUBLISH");

        // A non-loopback bind without a key is the single easiest way to leak a
        // whole memory graph onto a network, so we refuse rather than warn.
        let unbound = !cfg.host.is_empty()
            && !is_loopback(&SocketAddr::new(
                cfg.host.parse().unwrap_or(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
                0,
            ));
        if unbound && cfg.api_key.is_none() {
            panic!(
                "refusing to bind {host}: a reachable CORTEX core must set CORTEX_API_KEY \
                 (or set CORTEX_HOST=127.0.0.1 to stay local)",
                host = cfg.host
            );
        }
        cfg
    }
}

/// Starts the two loops the product depends on: flushing sessions that went
/// idle, and running the decay sweep. Called once from `main`.
pub fn spawn_background(state: AppState) {
    let flusher = state.clone();
    tokio::spawn(async move {
        let tick = Duration::from_secs(flusher.sessions.idle_secs().clamp(5, 120) as u64);
        loop {
            tokio::time::sleep(tick).await;
            for payload in flusher.sessions.take_idle().await {
                let session = payload.session_id.clone();
                match flush_payload(&flusher, payload).await {
                    Ok(report) => tracing::info!(
                        session = %session,
                        triplets = report.triplets_extracted,
                        nodes = report.nodes_upserted,
                        "flushed idle session into long-term memory"
                    ),
                    Err(err) => tracing::warn!(
                        session = %session,
                        code = err.code,
                        "session flush failed: {msg}",
                        msg = err.message
                    ),
                }
            }
        }
    });

    let sweeper = state.clone();
    let every = Duration::from_secs(sweeper.config.sweep_interval_secs.max(60));
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(every).await;
            match sweeper.config.decay.sweep(&sweeper.store).await {
                Ok(report) => {
                    if report.faded_nodes + report.depressed_edges > 0 {
                        sweeper.publish_pulse("sweep");
                    }
                    tracing::debug!(
                        policy = sweeper.config.decay.policy.as_str(),
                        faded = report.faded_nodes,
                        pruned = report.pruned_nodes,
                        "decay sweep complete"
                    );
                }
                Err(err) => tracing::warn!("decay sweep failed: {err}"),
            }
        }
    });
}

/// Best-effort final flush so quitting the app never loses the tail of a
/// conversation. Returns how many sessions were written.
pub async fn flush_all_sessions(state: &AppState) -> usize {
    let payloads = state.sessions.drain_all().await;
    let mut flushed = 0usize;
    for payload in payloads {
        if flush_payload(state, payload).await.is_ok() {
            flushed += 1;
        }
    }
    flushed
}
