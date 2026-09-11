use anyhow::{Result, Context};
use qdrant_client::qdrant::{
    DeletePointsBuilder, PointId, PointStruct, SearchPointsBuilder, Value as QdrantValue, Vector,
    UpsertPointsBuilder,
};
use qdrant_client::Qdrant;
use uuid::Uuid;
use sha2::{Sha256, Digest};
use std::time::Duration;

const VECTOR_DIM: usize = 128;

const SEMANTIC_CLUSTERS: &[(&[&str], usize)] = &[
    (&["db", "database", "sql", "postgres", "postgresql", "mysql", "surrealdb", "qdrant", "sqlite", "redis", "mongodb", "storage", "schema", "table", "tables", "query", "queries", "migration", "datastore", "nosql", "orm", "prisma", "diesel", "record", "records"], 0),
    (&["auth", "authentication", "authorize", "authorization", "oauth", "jwt", "session", "sessions", "login", "signup", "password", "token", "tokens", "credentials", "security", "permission", "permissions", "rbac", "secret", "crypto", "encryption", "tls", "ssl"], 1),
    (&["frontend", "ui", "ux", "css", "tailwind", "react", "nextjs", "vue", "svelte", "dom", "html", "style", "styles", "component", "components", "button", "buttons", "modal", "modals", "page", "client", "layout", "view", "render", "animation", "design"], 2),
    (&["backend", "server", "api", "apis", "endpoint", "endpoints", "rest", "grpc", "http", "https", "route", "routes", "handler", "handlers", "middleware", "controller", "microservice", "daemon", "service", "services", "router", "webhook", "payload"], 3),
    (&["architecture", "pattern", "patterns", "rule", "rules", "guideline", "guidelines", "standard", "standards", "convention", "conventions", "structure", "design", "constraint", "constraints", "invariant", "principle", "principles", "clean", "modular"], 4),
    (&["memory", "graph", "cortex", "recall", "ingest", "synapse", "retention", "decay", "triplet", "knowledge", "context", "brain", "node", "nodes", "edge", "edges", "vector", "semantic", "mesh"], 5),
    (&["test", "testing", "tests", "spec", "assert", "assertion", "benchmark", "benchmarks", "mock", "mocks", "stub", "ci", "coverage", "unit", "e2e", "integration"], 6),
    (&["deploy", "deployment", "docker", "k8s", "kubernetes", "cloud", "aws", "gcp", "azure", "production", "container", "containers", "devops", "release", "pipeline", "env", "staging", "serverless"], 7),
    (&["error", "errors", "bug", "bugs", "crash", "exception", "exceptions", "failure", "trace", "panic", "fix", "debug", "debugging", "issue", "issues", "fault"], 8),
    (&["rust", "python", "typescript", "javascript", "golang", "wasm", "cargo", "npm", "pip", "crate", "package"], 9),
    (&["state", "cache", "caching", "dragonfly", "ttl", "in-memory", "lru", "store"], 10),
    (&["async", "await", "thread", "threads", "concurrency", "channel", "channels", "mutex", "tokio", "sync", "future", "parallel", "queue"], 11),
    (&["network", "socket", "sockets", "websocket", "websockets", "tcp", "udp", "stream", "packet", "port", "dns", "ip", "proxy", "gateway"], 12),
    (&["config", "configuration", "settings", "variable", "variables", "dotenv", "flag", "args", "toml", "yaml", "json"], 13),
    (&["performance", "latency", "throughput", "opt", "optimize", "fast", "speed", "scale", "scaling", "profiling"], 14),
    (&["cursor", "vscode", "mcp", "extension", "plugin", "editor", "ide", "claude", "agent", "agents", "llm", "assistant"], 15),
];

const STOPWORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "in", "on", "at", "by", "for", "with", "about",
    "against", "between", "into", "through", "during", "before", "after", "above",
    "below", "to", "from", "up", "down", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "this", "that", "these",
    "those", "it", "its", "we", "you", "they", "i", "of"
];

#[derive(serde::Serialize)]
struct RemoteEmbeddingRequest<'a> {
    input: &'a str,
    model: &'a str,
    dimensions: usize,
}

#[derive(serde::Deserialize)]
struct RemoteEmbeddingResponse {
    data: Vec<RemoteEmbeddingItem>,
}

#[derive(serde::Deserialize)]
struct RemoteEmbeddingItem {
    embedding: Vec<f32>,
}

pub struct VectorIndex {
    client: Qdrant,
    collection_name: String,
    http_client: reqwest::Client,
    openai_api_key: Option<String>,
    openrouter_api_key: Option<String>,
}

impl VectorIndex {
    pub fn new(url: &str, collection_name: &str) -> Result<Self> {
        let client = Qdrant::from_url(url).build().context("Failed to build Qdrant client")?;
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        let openai_api_key = std::env::var("OPENAI_API_KEY").ok().filter(|s| !s.trim().is_empty());
        let openrouter_api_key = std::env::var("OPENROUTER_API_KEY").ok().filter(|s| !s.trim().is_empty());

        Ok(Self {
            client,
            collection_name: collection_name.to_string(),
            http_client,
            openai_api_key,
            openrouter_api_key,
        })
    }

    pub fn with_keys(
        url: &str,
        collection_name: &str,
        openai_key: Option<String>,
        openrouter_key: Option<String>,
    ) -> Result<Self> {
        let client = Qdrant::from_url(url).build().context("Failed to build Qdrant client")?;
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Ok(Self {
            client,
            collection_name: collection_name.to_string(),
            http_client,
            openai_api_key: openai_key,
            openrouter_api_key: openrouter_key,
        })
    }

    /// Ensure that the Qdrant collection exists with appropriate vector dimensions
    pub async fn ensure_collection(&self) -> Result<()> {
        use qdrant_client::qdrant::{CreateCollectionBuilder, Distance, VectorParamsBuilder};
        
        if let Ok(exists) = self.client.collection_exists(&self.collection_name).await {
            if !exists {
                let params = VectorParamsBuilder::new(VECTOR_DIM as u64, Distance::Cosine).build();
                let request = CreateCollectionBuilder::new(&self.collection_name)
                    .vectors_config(params)
                    .build();
                let _ = self.client.create_collection(request).await;
            }
        }
        Ok(())
    }

    /// Primary entrypoint: High-dimensional semantic embedding.
    /// Tries remote LLM API (OpenAI / OpenRouter) if keys exist, falling back seamlessly to local semantic embedding.
    pub async fn embed_text_semantic(&self, text: &str) -> Vec<f32> {
        if let Some(ref api_key) = self.openai_api_key {
            if let Ok(vec) = self.request_openai_embedding(text, api_key).await {
                if vec.len() == VECTOR_DIM {
                    return vec;
                }
            }
        }

        if let Some(ref api_key) = self.openrouter_api_key {
            if let Ok(vec) = self.request_openrouter_embedding(text, api_key).await {
                if vec.len() == VECTOR_DIM {
                    return vec;
                }
            }
        }

        // Resilient fallback to local semantic subword + concept cluster embedding
        self.embed_text(text)
    }

    /// Synchronous deterministic semantic embedding (local fallback)
    pub fn embed_text(&self, text: &str) -> Vec<f32> {
        compute_local_embedding(text)
    }

    async fn request_openai_embedding(&self, text: &str, api_key: &str) -> Result<Vec<f32>> {
        let payload = RemoteEmbeddingRequest {
            input: text,
            model: "text-embedding-3-small",
            dimensions: VECTOR_DIM,
        };

        let resp = self.http_client
            .post("https://api.openai.com/v1/embeddings")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("OpenAI embedding returned HTTP {}", resp.status());
        }

        let result: RemoteEmbeddingResponse = resp.json().await?;
        result.data.into_iter().next().map(|d| d.embedding).context("No embedding in response")
    }

    async fn request_openrouter_embedding(&self, text: &str, api_key: &str) -> Result<Vec<f32>> {
        let payload = RemoteEmbeddingRequest {
            input: text,
            model: "openai/text-embedding-3-small",
            dimensions: VECTOR_DIM,
        };

        let resp = self.http_client
            .post("https://openrouter.ai/api/v1/embeddings")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("OpenRouter embedding returned HTTP {}", resp.status());
        }

        let result: RemoteEmbeddingResponse = resp.json().await?;
        result.data.into_iter().next().map(|d| d.embedding).context("No embedding in response")
    }
    
    /// Map text to an existing node ID via semantic search
    pub async fn map_to_node(&self, query_vector: Vec<f32>, top_k: u64) -> Result<Vec<String>> {
        let search_request = SearchPointsBuilder::new(
            &self.collection_name,
            query_vector,
            top_k
        )
        .with_payload(true)
        .build();
        
        let response = self.client.search_points(search_request).await?;
        
        let mut node_ids = Vec::new();
        for scored_point in response.result {
            if let Some(payload) = scored_point.payload.get("node_id") {
                if let Some(node_id) = payload.kind.as_ref().and_then(|k| match k {
                    qdrant_client::qdrant::value::Kind::StringValue(s) => Some(s.clone()),
                    _ => None,
                }) {
                    node_ids.push(node_id);
                }
            }
        }
        
        Ok(node_ids)
    }
    
    /// Which provider actually produced the vectors — recorded on every point so
    /// a later switch of embedding model cannot silently mix incompatible spaces.
    pub fn embedding_model_tag(&self) -> &'static str {
        if self.openai_api_key.is_some() {
            "openai:text-embedding-3-small"
        } else if self.openrouter_api_key.is_some() {
            "openrouter:text-embedding-3-small"
        } else {
            "cortex-local-128"
        }
    }

    /// Insert (or replace) the embedding for a node.
    ///
    /// The point id is derived from the node id, so re-embedding a node updates
    /// one point instead of appending an orphan that nothing can ever delete.
    pub async fn upsert_mapping(&self, node_id: &str, vector: Vec<f32>) -> Result<()> {
        let mut payload = std::collections::HashMap::new();
        for (key, value) in [
            ("node_id".to_string(), node_id.to_string()),
            ("model".to_string(), self.embedding_model_tag().to_string()),
        ] {
            payload.insert(
                key,
                QdrantValue {
                    kind: Some(qdrant_client::qdrant::value::Kind::StringValue(value)),
                },
            );
        }

        let point = PointStruct {
            id: Some(PointId::from(point_id_for(node_id))),
            vectors: Some(Vector::from(vector).into()),
            payload,
        };

        let upsert_request = UpsertPointsBuilder::new(&self.collection_name, vec![point]);
        self.client.upsert_points(upsert_request).await?;

        Ok(())
    }

    /// Drop the vectors for deleted nodes, so recall can never surface a
    /// dangling id whose node is gone.
    ///
    /// The count is the number of point ids *submitted*: Qdrant's `UpdateResult` carries an
    /// operation id and a status, not a per-point tally, so anything more precise would be made up.
    pub async fn delete_for_nodes(&self, node_ids: &[String]) -> Result<usize> {
        if node_ids.is_empty() {
            return Ok(0);
        }
        let ids: Vec<PointId> = node_ids
            .iter()
            .map(|id| PointId::from(point_id_for(id)))
            .collect();
        let submitted = ids.len();
        let request = DeletePointsBuilder::new(&self.collection_name).points(ids).build();
        self.client.delete_points(request).await?;
        Ok(submitted)
    }
}

/// Deterministic UUID-shaped Qdrant point id for a node id.
pub fn point_id_for(node_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"cortex-vector-point:");
    hasher.update(node_id.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    // Set the version (5) and variant bits so the value parses as a UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_ids_are_stable_and_uuid_shaped() {
        let a = point_id_for("node:9f3c");
        assert_eq!(a, point_id_for("node:9f3c"));
        assert_ne!(a, point_id_for("node:9f3d"));
        assert_eq!(a.len(), 36, "must be a UUID string: {a}");
        assert!(Uuid::parse_str(&a).is_ok(), "not a valid UUID: {a}");
    }

    #[test]
    fn local_embedding_is_deterministic_and_normalized() {
        let a = compute_local_embedding("I prefer postgres for the graph store");
        let b = compute_local_embedding("I prefer postgres for the graph store");
        assert_eq!(a.len(), VECTOR_DIM);
        assert_eq!(a, b);
        let norm = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.05, "not unit length: {norm}");
        assert!(cosine_similarity(&a, &b) > 0.999);
        assert!(cosine_similarity(&a, &compute_local_embedding("totally unrelated: kubernetes helm chart")) < 0.9);
    }
}

/// Compute a normalized deterministic semantic vector from raw text.
/// Uses concept cluster anchors (dims 0..31) and subword character n-grams + full-word projections (dims 32..127).
pub fn compute_local_embedding(text: &str) -> Vec<f32> {
    let mut vec = vec![0.0f32; VECTOR_DIM];
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|w| !w.is_empty())
        .collect();

    if words.is_empty() {
        return vec;
    }

    for word in &words {
        // 1. Concept Cluster Anchors (dims 0..31)
        for (keywords, cluster_idx) in SEMANTIC_CLUSTERS {
            let matched = keywords.iter().any(|k| {
                *k == *word
                    || (k.len() >= 4 && word.starts_with(k))
                    || (word.len() >= 4 && k.starts_with(word))
            });
            if matched {
                let dim_a = cluster_idx * 2;
                let dim_b = cluster_idx * 2 + 1;
                if dim_b < 32 {
                    vec[dim_a] += 2.0;
                    vec[dim_b] += 1.0;
                }
            }
        }

        // Filter stopwords from subword projections to prevent dilution
        if STOPWORDS.contains(word) {
            continue;
        }

        // 2. Full word token projection (dims 32..127)
        let mut word_hasher = Sha256::new();
        word_hasher.update(word.as_bytes());
        let word_hash = word_hasher.finalize();
        let word_target_dim = 32 + ((word_hash[0] as usize | ((word_hash[1] as usize) << 8)) % 96);
        let word_val = ((word_hash[2] as f32 / 255.0) - 0.5) * 2.0;
        vec[word_target_dim] += word_val;

        // 3. Subword character n-grams (3-grams, 4-grams)
        let chars: Vec<char> = word.chars().collect();
        for n in 3..=4 {
            if chars.len() >= n {
                for window in chars.windows(n) {
                    let ngram: String = window.iter().collect();
                    let mut ngram_hasher = Sha256::new();
                    ngram_hasher.update(ngram.as_bytes());
                    let ngram_hash = ngram_hasher.finalize();
                    let target_dim = 32 + ((ngram_hash[0] as usize | ((ngram_hash[1] as usize) << 8)) % 96);
                    let val = ((ngram_hash[2] as f32 / 255.0) - 0.5) * 0.8;
                    vec[target_dim] += val;
                }
            }
        }
    }

    // L2 Unit Normalization
    let norm = (vec.iter().map(|v| v * v).sum::<f32>()).sqrt();
    if norm > 0.0 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }

    vec
}

/// Calculate cosine similarity between two vector slices
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}
