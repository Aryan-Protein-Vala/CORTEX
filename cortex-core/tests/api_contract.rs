//! HTTP contract tests for the memory engine.
//!
//! These exist because every one of the launch blockers below was invisible in
//! unit tests: ids that did not round-trip between write and read, a token
//! budget that was echoed instead of enforced, an unauthenticated `0.0.0.0`
//! bind, and 200s that carried errors. They drive `build_router` in-process, so
//! the exact production middleware stack is under test.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::Router;
use cortex_core::api::server::{AppState, CoreConfig, JobRegistry};
use cortex_core::engine::decay::DecayEngine;
use cortex_core::storage::graph_store::GraphStore;
use cortex_core::storage::session::SessionBuffer;
use cortex_core::storage::store::FileGraphStore;
use http_body_util::BodyExt;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn scratch_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "cortex-api-{}-{tag}-{n}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

async fn build_state(config: CoreConfig, tag: &str) -> (AppState, PathBuf) {
    let dir = scratch_dir(tag);
    let store = FileGraphStore::open(dir.join("cortex-graph.json"))
        .await
        .expect("file store");
    let state = AppState {
        store: GraphStore::File(Arc::new(store)),
        sessions: Arc::new(SessionBuffer::new(90, 40, 64)),
        extractor: None,
        mesh_sink: None,
        jobs: Arc::new(Mutex::new(JobRegistry::default())),
        inflight: Arc::new(tokio::sync::Semaphore::new(4)),
        ws_tx: Arc::new(tokio::sync::broadcast::channel(16).0),
        config: Arc::new(config),
        started_at: chrono::Utc::now(),
        rate: Arc::new(Mutex::new(HashMap::new())),
        vector: None,
    };
    (state, dir)
}

fn local_config() -> CoreConfig {
    CoreConfig {
        host: "127.0.0.1".into(),
        port: 0,
        api_key: None,
        rate_limit_per_min: 0, // keep tests deterministic
        decay: DecayEngine::new(),
        ..CoreConfig::default()
    }
}

fn request(
    method: Method,
    uri: &str,
    json: Option<serde_json::Value>,
    bearer: Option<&str>,
) -> Request<Body> {
    let body = match json {
        Some(value) => Body::from(value.to_string()),
        None => Body::empty(),
    };
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        // The guard treats a missing socket as "not loopback", so tests must say
        // where the request came from just like axum's serve layer does.
        .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 55_999))));
    if let Some(key) = bearer {
        builder = builder.header(HeaderName::from_static("authorization"), HeaderValue::from_str(&format!("Bearer {key}")).unwrap());
    }
    builder
        .header("content-type", "application/json")
        .body(body)
        .expect("valid request")
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body collect")
        .to_bytes();
    if bytes.is_empty() {
        return serde_json::Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        panic!(
            "expected JSON body, got {:?} ({e})",
            String::from_utf8_lossy(&bytes).chars().take(240).collect::<String>()
        )
    })
}

async fn ingest(router: &Router, text: &str, owner: Option<&str>) -> (StatusCode, serde_json::Value) {
    let mut payload = serde_json::json!({ "prompt": text, "wait": true, "source": "test" });
    if let Some(owner) = owner {
        payload["owner"] = serde_json::Value::String(owner.to_string());
    }
    let response = router
        .clone()
        .oneshot(request(Method::POST, "/v1/ingest", Some(payload), None))
        .await
        .expect("ingest");
    let status = response.status();
    (status, response_json(response).await)
}

async fn stats(router: &Router) -> serde_json::Value {
    let response = router
        .clone()
        .oneshot(request(Method::GET, "/v1/stats", None, None))
        .await
        .unwrap();
    response_json(response).await
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn ingested_fact_is_recalled_with_labels_and_single_prefixed_ids() {
    let (state, dir) = build_state(local_config(), "roundtrip").await;
    let router = cortex_core::api::server::build_router(state);

    let (status, report) = ingest(
        &router,
        "USER: I prefer Postgres over MySQL for the memory store\nUSER: never use raw SQL string concatenation\n",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "wait:true must report the outcome");
    let result = &report["result"];
    assert!(
        result["triplets_extracted"].as_u64().unwrap_or(0) >= 2,
        "heuristic extractor should find both facts: {report}"
    );
    assert!(result["nodes_new"].as_u64().unwrap_or(0) >= 2, "{report}");

    // The regression this whole path was broken by: recall found nothing because
    // the write key (`node:node:x`) and read key (`node:x`) disagreed.
    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "which database should we use for the store" })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let recall = response_json(response).await;
    assert!(
        recall["memories_found"].as_u64().unwrap_or(0) > 0,
        "recall found nothing: {recall}"
    );
    let briefing = recall["briefing"].as_str().unwrap_or_default();
    assert!(
        briefing.to_lowercase().contains("postgres"),
        "briefing must name the fact: {briefing}"
    );
    assert!(
        !briefing.contains("node:node:"),
        "briefing must not leak doubled ids: {briefing}"
    );
    assert!(
        !briefing.contains("node:"),
        "briefing must show labels, not ids: {briefing}"
    );

    // The dashboard's 3D brain reads /v1/memories; the owner_uri mismatch used to
    // leave it permanently empty.
    let response = router
        .clone()
        .oneshot(request(Method::GET, "/v1/memories?limit=50", None, None))
        .await
        .unwrap();
    let memories = response_json(response).await;
    let nodes = memories["memories"].as_array().cloned().unwrap_or_default();
    assert!(!nodes.is_empty(), "memory list is empty: {memories}");
    for node in &nodes {
        let id = node["id"].as_str().unwrap_or_default();
        assert_eq!(
            id.matches("node:").count(),
            1,
            "id must carry exactly one namespace prefix: {id}"
        );
        assert_eq!(node["owner_uri"], "cortex://default");
    }

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn restating_a_fact_reinforces_instead_of_duplicating() {
    let (state, dir) = build_state(local_config(), "idempotent").await;
    let router = cortex_core::api::server::build_router(state);
    let text = "USER: I prefer Postgres over MySQL\n";

    let (status, first) = ingest(&router, text, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(first["result"]["nodes_new"].as_u64().unwrap_or(0) > 0, "{first}");

    let (_, second) = ingest(&router, text, None).await;
    assert_eq!(
        second["result"]["nodes_new"].as_u64().unwrap_or(9),
        0,
        "same fact must not create new nodes: {second}"
    );
    assert_eq!(
        second["result"]["edges_new"].as_u64().unwrap_or(9),
        0,
        "same fact must not create new edges: {second}"
    );

    let count = |stats: &serde_json::Value| stats["nodes"].as_u64().unwrap_or(0);
    let before = count(&stats(&router).await);
    ingest(&router, text, None).await;
    let after = count(&stats(&router).await);
    assert_eq!(before, after, "re-ingesting the same fact grew the graph");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn owner_namespaces_stay_isolated() {
    let (state, dir) = build_state(local_config(), "owners").await;
    let router = cortex_core::api::server::build_router(state);

    ingest(&router, "USER: I prefer Postgres", Some("cortex://alice")).await;
    ingest(&router, "USER: I prefer MongoDB", Some("cortex://bob")).await;

    for (owner, needle) in [("alice", "postgres"), ("bob", "mongo")] {
        let response = router
            .clone()
            .oneshot(request(
                Method::POST,
                "/v1/recall",
                Some(serde_json::json!({ "prompt": "database", "owner": format!("cortex://{owner}") })),
                None,
            ))
            .await
            .unwrap();
        let recall = response_json(response).await;
        let briefing = recall["briefing"].as_str().unwrap_or_default().to_lowercase();
        assert!(briefing.contains(needle), "{owner} must see {needle}: {briefing}");
        let other = if owner == "alice" { "mongo" } else { "postgres" };
        assert!(!briefing.contains(other), "{owner} leaked {other}'s memory: {briefing}");
    }

    // `default_user` (what the MCP used to send) must normalise to the same
    // namespace as `cortex://default`, not fork a second graph.
    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "database", "user_id": "default" })),
            None,
        ))
        .await
        .unwrap();
    let recall = response_json(response).await;
    assert_eq!(recall["owner_uri"], "cortex://default");
    assert_eq!(
        recall["memories_found"].as_u64().unwrap_or(9),
        0,
        "the default namespace must be empty here: {recall}"
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn token_budget_is_actually_enforced() {
    let (state, dir) = build_state(local_config(), "budget").await;
    let router = cortex_core::api::server::build_router(state);

    let mut lines = String::new();
    for i in 0..40 {
        lines.push_str(&format!("USER: I prefer option{i} when building widget{i} for project{i}\n"));
    }
    ingest(&router, &lines, None).await;

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "option widget project", "token_budget": 64 })),
            None,
        ))
        .await
        .unwrap();
    let recall = response_json(response).await;
    let used = recall["tokens_used"].as_u64().unwrap_or(u64::MAX);
    assert!(used <= 64, "budget of 64 tokens produced {used}: {recall}");
    assert_eq!(recall["token_budget"], 64);
    assert!(
        recall["truncated"].as_bool().unwrap_or(false),
        "a packed briefing must admit it was truncated: {recall}"
    );
    let briefing = recall["briefing"].as_str().unwrap_or_default();
    assert!(
        briefing.lines().count() < 40,
        "everything fit inside a 64-token budget? {briefing}"
    );

    // A budget above the server cap is clamped, not honoured.
    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "option", "token_budget": 10_000_000 })),
            None,
        ))
        .await
        .unwrap();
    let recall = response_json(response).await;
    assert_eq!(recall["token_budget"], 4_000, "budget must clamp to the server max");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn a_keyed_server_refuses_anonymous_and_wrong_keys() {
    let mut config = local_config();
    config.api_key = Some("s3cr3t-cortex".into());
    let (state, dir) = build_state(config, "auth").await;
    let router = cortex_core::api::server::build_router(state);

    // Health stays open so the extension popup can show real status.
    let response = router
        .clone()
        .oneshot(request(Method::GET, "/health", None, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let health = response_json(response).await;
    assert_eq!(health["status"], "ok");
    assert_eq!(
        health["cloud_sync"].as_bool(),
        Some(false),
        "health must not claim cloud sync: {health}"
    );

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "x" })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = response_json(response).await;
    assert_eq!(body["error"]["code"], "unauthorized", "{body}");

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "x" })),
            Some("wrong-key"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // Header, custom header and query param all authenticate.
    for (uri, bearer) in [
        ("/v1/stats", Some("s3cr3t-cortex")),
        ("/v1/stats", None),
    ] {
        let uri = if bearer.is_some() {
            uri.to_string()
        } else {
            "/v1/stats?key=s3cr3t-cortex".to_string()
        };
        let mut req = Request::builder()
            .method(Method::GET)
            .uri(&uri)
            .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 56_000))));
        if let Some(key) = bearer {
            req = req.header("x-cortex-key", key);
        }
        let response = router
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "auth via {uri} failed");
    }

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn foreign_peers_need_a_key() {
    let (state, dir) = build_state(local_config(), "peer").await;
    let router = cortex_core::api::server::build_router(state);

    let mut req = request(Method::GET, "/v1/stats", None, None);
    *req.extensions_mut() = axum::http::Extensions::new(); // no ConnectInfo at all
    let response = router.clone().oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::FORBIDDEN,
        "an unauthenticated non-loopback peer must be refused"
    );
    let body = response_json(response).await;
    assert_eq!(body["error"]["code"], "forbidden");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn rate_limit_rejects_bursts() {
    let mut config = local_config();
    config.rate_limit_per_min = 2;
    let (state, dir) = build_state(config, "rate").await;
    let router = cortex_core::api::server::build_router(state);

    for expected in [StatusCode::OK, StatusCode::OK, StatusCode::TOO_MANY_REQUESTS] {
        let response = router
            .clone()
            .oneshot(request(
                Method::POST,
                "/v1/recall",
                Some(serde_json::json!({ "prompt": "nothing" })),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "rate limiting drift");
    }

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn unimplemented_surfaces_say_so_instead_of_faking_success() {
    let (state, dir) = build_state(local_config(), "honest").await;
    let router = cortex_core::api::server::build_router(state);

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/mesh/publish",
            Some(serde_json::json!({ "nodes": [], "edges": [] })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
    let body = response_json(response).await;
    assert_eq!(body["error"]["code"], "mesh_publish_disabled");

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/crawler/config",
            Some(serde_json::json!({ "watch_dirs": ["."] })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn session_buffering_then_flush_remembers_the_conversation() {
    let (state, dir) = build_state(local_config(), "session").await;
    let router = cortex_core::api::server::build_router(state);

    for (role, content) in [
        ("user", "I only use TypeScript on this project"),
        ("assistant", "Got it — strict mode then?"),
        ("user", "yes, and I prefer Vitest over Jest"),
    ] {
        let response = router
            .clone()
            .oneshot(request(
                Method::POST,
                "/v1/session/message",
                Some(serde_json::json!({
                    "session_id": "ext-chat-1",
                    "role": role,
                    "content": content,
                    "source": "extension",
                })),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "session write failed");
        let body = response_json(response).await;
        assert_eq!(body["buffered"], true, "turns must buffer, not extract: {body}");
    }

    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/flush",
            Some(serde_json::json!({ "session_id": "ext-chat-1" })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let flushed = response_json(response).await;
    assert!(
        flushed["results"][0]["triplets_extracted"]
            .as_u64()
            .unwrap_or(0)
            > 0,
        "flush produced no memories: {flushed}"
    );

    // Assistant turns must not become facts about the user.
    let response = router
        .clone()
        .oneshot(request(
            Method::POST,
            "/v1/recall",
            Some(serde_json::json!({ "prompt": "vitest typescript" })),
            None,
        ))
        .await
        .unwrap();
    let recall = response_json(response).await;
    let briefing = recall["briefing"].as_str().unwrap_or_default().to_lowercase();
    assert!(briefing.contains("vitest") || briefing.contains("typescript"), "{briefing}");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn deleting_a_memory_takes_its_edges_with_it() {
    let (state, dir) = build_state(local_config(), "cascade").await;
    let router = cortex_core::api::server::build_router(state);

    ingest(&router, "USER: I prefer Postgres\nUSER: I use Docker", None).await;
    let memories = response_json(
        router
            .clone()
            .oneshot(request(Method::GET, "/v1/memories?limit=50", None, None))
            .await
            .unwrap(),
    )
    .await;
    let nodes = memories["memories"].as_array().cloned().unwrap_or_default();
    assert!(nodes.len() >= 2, "{nodes:?}");
    let target = nodes[0]["id"].as_str().unwrap().to_string();
    let before = stats(&router).await;

    let response = router
        .clone()
        .oneshot(request(
            Method::DELETE,
            &format!("/v1/memories/{target}"),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Deleting again is a 404 with a machine-readable code, never a 200.
    let response = router
        .clone()
        .oneshot(request(
            Method::DELETE,
            &format!("/v1/memories/{target}"),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = response_json(response).await;
    assert_eq!(body["error"]["code"], "not_found");

    let after = stats(&router).await;
    assert_eq!(
        after["nodes"].as_u64().unwrap(),
        before["nodes"].as_u64().unwrap() - 1,
        "node count did not drop"
    );
    assert!(
        after["edges"].as_u64().unwrap_or(9) < before["edges"].as_u64().unwrap_or(9),
        "the deleted node's edges must cascade away: before={before} after={after}"
    );

    // And the file on disk agrees, so persistence is not just in-memory state.
    let raw = std::fs::read_to_string(dir.join("cortex-graph.json")).unwrap_or_default();
    assert!(!raw.contains(&target), "deleted id still in the store file");

    let _ = std::fs::remove_dir_all(dir);
}
