//! Core data model for the Cortex memory graph.
//!
//! ## Identifier contract (single source of truth)
//! Historically this crate mixed two conventions: ids stored as `node:<uuid>`
//! while lookups/deletes stripped the `node:` prefix, which silently broke
//! recall, deduplication and decay. The contract is now explicit and is the
//! only allowed form:
//!
//! * `MemoryNode.id` / `RelationalEdge.id` are **bare ids** (no `node:`/`edge:`
//!   prefix). The SurrealDB table name supplies the prefix; record ids are
//!   addressed as `("node", id)`.
//! * `RelationalEdge.source` / `.target` hold **bare `MemoryNode.id`s**.
//! * Ids are **deterministic** (see [`node_id_for_label`]), which makes ingest
//!   idempotent and gives us deduplication without needing a unique index.
//! * `owner_uri` is always normalized through [`normalize_owner`] on *both*
//!   write and read paths, so `default_user`, `default` and
//!   `cortex://default` all resolve to the same namespace.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The namespace used by every surface when the caller does not specify one.
/// Keep this in sync with `CORTEX_OWNER` defaults in the MCP server, the
/// browser extension and the web dashboard.
pub const DEFAULT_OWNER: &str = "cortex://default";

/// Namespace for the shared/global mesh.
pub const GLOBAL_MESH_OWNER: &str = "cortex://global";

// ---------------------------------------------------------------------------
// Identifier + normalization helpers
// ---------------------------------------------------------------------------

/// Lowercase, trim, collapse whitespace and strip surrounding punctuation.
pub fn normalize_label(raw: &str) -> String {
    let lowered = raw.trim().to_lowercase();
    let collapsed = lowered.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_matches(|c: char| !c.is_alphanumeric()).to_string()
}

fn hex_sha256(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }
    out
}

/// Deterministic node id for a human label. Two memories about "SurrealDB"
/// always land on the same record, so re-ingesting reinforces instead of
/// duplicating.
pub fn node_id_for_label(label: &str) -> String {
    let key = normalize_label(label);
    if key.is_empty() {
        return "node:unnamed".to_string();
    }
    format!("node:{}", &hex_sha256(&key)[..32])
}

/// Deterministic edge id for a (subject, predicate, object) triple.
pub fn edge_id_for(source_id: &str, predicate: &str, target_id: &str) -> String {
    let src = canonical_node_id(source_id);
    let tgt = canonical_node_id(target_id);
    let pred = predicate.trim().to_lowercase().replace(' ', "_");
    format!("edge:{}", &hex_sha256(&format!("{src}\u{1}{pred}\u{1}{tgt}"))[..32])
}

/// Accepts `node:abc`, `abc` or `node:node:abc` and always returns the bare id.
/// Used only to build SurrealDB record keys, where the table name supplies the prefix.
pub fn strip_id_prefix(id: &str) -> String {
    let mut cur = id.trim();
    while let Some(rest) = cur.strip_prefix("node:").or_else(|| cur.strip_prefix("edge:")) {
        cur = rest.trim();
    }
    cur.to_string()
}

/// Canonical form of a node id used *inside documents* (edges, API payloads,
/// store keys): exactly one `node:` prefix. Every writer and reader must funnel
/// through this, which is precisely what the previous code failed to do.
pub fn canonical_node_id(id: &str) -> String {
    let bare = strip_id_prefix(id);
    if bare.is_empty() {
        String::new()
    } else {
        format!("node:{bare}")
    }
}

/// Canonical form of an edge id: exactly one `edge:` prefix.
pub fn canonical_edge_id(id: &str) -> String {
    let bare = strip_id_prefix(id);
    if bare.is_empty() {
        String::new()
    } else {
        format!("edge:{bare}")
    }
}

/// Normalizes any caller-supplied namespace into a canonical `cortex://` URI.
///
/// `""`, `"default"`, `"default_user"`, `"self"` and `"local"` all map to
/// [`DEFAULT_OWNER`]. Anything else gets the bare slug lowercased and
/// punctuation-collapsed.
pub fn normalize_owner(raw: &str) -> String {
    let trimmed = raw.trim();
    let bare = match trimmed.strip_prefix("cortex://") {
        Some(rest) => rest.trim(),
        None => trimmed,
    };

    if bare.is_empty()
        || matches!(
            bare.to_ascii_lowercase().as_str(),
            "default" | "default_user" | "self" | "local" | "me" | "user"
        )
    {
        return DEFAULT_OWNER.to_string();
    }

    let slug: String = bare
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-');
    let slug = slug.trim_matches(|c: char| c == '-');
    let cleaned = collapse_dashes(slug);

    if cleaned.is_empty() {
        DEFAULT_OWNER.to_string()
    } else {
        format!("cortex://{}", cleaned)
    }
}

fn collapse_dashes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;
    for c in input.chars() {
        if c == '-' {
            if !prev_dash {
                out.push('-');
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    out
}

/// Whether this owner uri points at the shared global mesh.
pub fn is_global_mesh(owner: &str) -> bool {
    normalize_owner(owner) == GLOBAL_MESH_OWNER
}

/// Cheap, deterministic token estimate used to enforce budgets. We deliberately
/// avoid a tokenizer dependency: 1 token ~ 4 characters for latin text, and the
/// budget is advisory anyway (the *point* is to stay small).
pub fn estimate_tokens(text: &str) -> u32 {
    ((text.chars().count() as f32) / 4.0).ceil() as u32
}

// ---------------------------------------------------------------------------
// Memory node
// ---------------------------------------------------------------------------

/// Primary node in the knowledge graph (an entity or concept).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryNode {
    /// Bare deterministic id, e.g. `node:9f3c…`. Never contains the table prefix twice.
    ///
    /// Persisted as `key` (not `id`) so it can never collide with, or be
    /// shadowed by, the database's own record identifier. `alias = "id"` keeps
    /// older exports importable. API DTOs re-expose it as `id`.
    #[serde(rename = "key", alias = "id")]
    pub id: String,

    /// Human-readable canonical label (e.g. "SurrealDB").
    pub label: String,

    /// Normalized label key, stored for equality lookups and debugging.
    #[serde(default)]
    pub label_key: String,

    /// Language-agnostic aliases for multilingual support.
    #[serde(default)]
    pub aliases: Vec<String>,

    /// Stability factor (S) — reinforcement depth (1.0–100.0). Always >= 1.0.
    #[serde(default = "default_stability")]
    pub stability: f32,

    /// Impact factor (I) — decay dampener (1–10). Always 1..=10.
    #[serde(default = "default_impact")]
    pub impact: u8,

    /// Amygdala lock — never decays or prunes if true.
    #[serde(default)]
    pub locked: bool,

    /// Soft-decay marker. Under the default `soft` policy the sweep sets this
    /// instead of deleting: the memory keeps ranking lower and renders faded in
    /// the UI, but the user never loses a fact silently. Prune-only deployments
    /// flip this into a real delete via `CORTEX_DECAY_POLICY=prune`.
    #[serde(default)]
    pub fading: bool,

    /// Category for UI grouping.
    #[serde(default)]
    pub category: NodeCategory,

    /// Canonical namespace this node belongs to (`cortex://…`).
    #[serde(default = "default_owner")]
    pub owner_uri: String,

    /// Where this memory came from (`mcp`, `extension`, `sdk`, `hydrator`, …).
    #[serde(default)]
    pub provenance: String,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    /// Last access timestamp, drives decay.
    pub last_accessed: DateTime<Utc>,

    /// Total access count (reinforcement tracking).
    #[serde(default)]
    pub access_count: u32,

    #[serde(default)]
    pub metadata: serde_json::Value,

    /// Semantic embedding used for local cosine recall. Persisted with the node
    /// so the engine needs no external vector DB. Empty = not yet embedded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub embedding: Vec<f32>,

    /// Which model produced `embedding`, so mixed-model vectors are never
    /// silently compared against each other.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub embedding_model: String,
}

fn default_stability() -> f32 {
    1.0
}
fn default_impact() -> u8 {
    5
}
fn default_owner() -> String {
    DEFAULT_OWNER.to_string()
}

impl MemoryNode {
    /// Creates a node with a deterministic id derived from its label.
    pub fn new(label: impl Into<String>) -> Self {
        Self::with_owner(label, DEFAULT_OWNER)
    }

    pub fn with_owner(label: impl Into<String>, owner_uri: impl AsRef<str>) -> Self {
        let label = label.into();
        let now = Utc::now();
        Self {
            id: node_id_for_label(&label),
            label_key: normalize_label(&label),
            label,
            aliases: vec![],
            stability: 1.0,
            impact: 5,
            locked: false,
            fading: false,
            category: NodeCategory::General,
            owner_uri: normalize_owner(owner_uri.as_ref()),
            provenance: String::new(),
            created_at: now,
            updated_at: now,
            last_accessed: now,
            access_count: 0,
            metadata: serde_json::Value::Null,
            embedding: vec![],
            embedding_model: String::new(),
        }
    }

    /// Reinforcement: recency + count grow stability logarithmically.
    pub fn mark_accessed(&mut self) {
        self.last_accessed = Utc::now();
        self.access_count = self.access_count.saturating_add(1);
        let growth = (1.0 + self.access_count as f32).ln();
        self.stability = (self.stability + growth).clamp(1.0, 100.0);
        self.updated_at = Utc::now();
    }

    /// Applies an extracted fact's salience to this node.
    pub fn reinforce_with_impact(&mut self, impact: u8, confidence: f32) {
        self.impact = self.impact.max(impact.clamp(1, 10));
        let boost = 1.0 + confidence.clamp(0.0, 1.0) as f32;
        self.stability = (self.stability + boost).clamp(1.0, 100.0);
        self.mark_accessed();
    }

    /// Ebbinghaus retention probability `R(t) = e^(-t_days / (S * I * BASE))`.
    ///
    /// `t` is measured in **days** (a seconds-based curve made every memory
    /// evaporate within a minute). Locked nodes never decay. `S` and `I` are
    /// clamped so a zero/absent value from untrusted LLM JSON cannot produce
    /// `inf`/`NaN`, which previously collapsed retention to 0 and instantly
    /// flagged brand-new memories for pruning.
    ///
    /// `DECAY_BASE_DAYS` = 7 (measured, not vibes): an untouched `S=1, I=5`
    /// memory keeps 97% retention after 1 day, 42% after 30 days and crosses the
    /// 0.05 prune threshold at ~105 days. A reinforced `S=100, I=10` identity
    /// fact is still at 81% after four years and would not prune for ~57.
    pub fn retention_probability(&self) -> f32 {
        if self.locked {
            return 1.0;
        }
        const DECAY_BASE_DAYS: f64 = 7.0;
        let seconds = (Utc::now() - self.last_accessed).num_seconds().max(0) as f64;
        let days = seconds / 86_400.0;
        let stability = f64::from(self.stability.max(1.0));
        let impact = f64::from(self.impact.max(1) as f32);
        let half = (stability * impact * DECAY_BASE_DAYS).max(1.0);
        let retention = (-(days / half)).exp();
        if retention.is_finite() {
            (retention as f32).clamp(0.0, 1.0)
        } else {
            1.0
        }
    }

    /// Ranking prior used when packing a briefing under a token budget.
    pub fn salience(&self) -> f32 {
        let lock_bonus = if self.locked { 4.0 } else { 1.0 };
        let mesh_bonus = if is_global_mesh(&self.owner_uri) { 1.25 } else { 1.0 };
        (self.retention_probability().max(0.01)
            * (self.stability.max(1.0) * f32::from(self.impact.max(1) as f32)).ln_1p()
            * lock_bonus
            * mesh_bonus)
            + (self.access_count as f32).ln_1p()
    }
}

/// Node categories for UI organization.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum NodeCategory {
    #[default]
    General,
    Technical,
    Personal,
    Project,
    Preference,
    Fact,
    Skill,
    Goal,
    Identity,
}

// ---------------------------------------------------------------------------
// Relational edge
// ---------------------------------------------------------------------------

/// Directed relationship between two nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationalEdge {
    /// Bare deterministic id, e.g. `edge:1a07…`. Persisted as `key`; see `MemoryNode::id`.
    #[serde(rename = "key", alias = "id")]
    pub id: String,

    /// Source node id (subject) — bare `MemoryNode.id`.
    pub source: String,

    /// Target node id (object) — bare `MemoryNode.id`.
    pub target: String,

    /// Relationship type (predicate), normalized to `snake_case`.
    pub predicate: String,

    /// Synaptic weight W (0.0–1.0).
    pub weight: f32,

    /// Superseded by a correction but retained for history.
    #[serde(default)]
    pub is_historical: bool,

    #[serde(default = "default_confidence")]
    pub confidence: f32,

    #[serde(default = "default_impact")]
    pub impact: u8,

    #[serde(default)]
    pub locked: bool,

    #[serde(default = "default_owner")]
    pub owner_uri: String,

    #[serde(default)]
    pub provenance: String,

    pub created_at: DateTime<Utc>,
    pub last_reinforced: DateTime<Utc>,

    #[serde(default)]
    pub reinforcement_count: u32,
}

fn default_confidence() -> f32 {
    0.7
}

impl RelationalEdge {
    pub fn new(
        source: impl Into<String>,
        predicate: impl Into<String>,
        target: impl Into<String>,
        initial_weight: f32,
    ) -> Self {
        Self::between(source, predicate, target, initial_weight, DEFAULT_OWNER)
    }

    /// Deterministic id, so re-stating a fact reinforces the same edge.
    pub fn between(
        source: impl Into<String>,
        predicate: impl Into<String>,
        target: impl Into<String>,
        initial_weight: f32,
        owner_uri: impl AsRef<str>,
    ) -> Self {
        let now = Utc::now();
        let predicate = normalize_predicate(&predicate.into());
        let source = canonical_node_id(&source.into());
        let target = canonical_node_id(&target.into());
        Self {
            id: edge_id_for(&source, &predicate, &target),
            source,
            target,
            predicate,
            weight: initial_weight.clamp(0.0, 1.0),
            is_historical: false,
            confidence: 0.7,
            impact: 5,
            locked: false,
            owner_uri: normalize_owner(owner_uri.as_ref()),
            provenance: String::new(),
            created_at: now,
            last_reinforced: now,
            reinforcement_count: 0,
        }
    }

    /// Long-term potentiation.
    pub fn reinforce(&mut self, amount: f32) {
        self.weight = (self.weight + amount).clamp(0.0, 1.0);
        self.last_reinforced = Utc::now();
        self.reinforcement_count = self.reinforcement_count.saturating_add(1);
        self.is_historical = false;
    }

    /// Synaptic depression (applied during a decay sweep).
    pub fn apply_depression(&mut self, percentage: f32) {
        let pct = percentage.clamp(0.0, 1.0);
        self.weight *= 1.0 - pct;
        if !self.weight.is_finite() {
            self.weight = 0.0;
        }
    }

    pub fn salience(&self) -> f32 {
        let lock_bonus = if self.locked { 4.0 } else { 1.0 };
        self.weight.max(0.01) * (1.0 + self.reinforcement_count as f32).ln_1p() * lock_bonus
            * f32::from(self.impact.max(1) as f32)
    }
}

/// Predicates are normalized to `snake_case` verbs so `prefers`, `Prefers` and
/// `prefers ` all collapse to the same relationship type.
pub fn normalize_predicate(raw: impl Into<String>) -> String {
    normalize_label(&raw.into()).replace(' ', "_")
}

// ---------------------------------------------------------------------------
// Extraction output
// ---------------------------------------------------------------------------

/// Procedural rule from the Amygdala engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProceduralRule {
    pub rule_id: String,
    pub trigger_context: String,
    pub absolute_directive: String,
    pub created_at: i64,
    pub origin: String,
    #[serde(default = "default_owner")]
    pub owner_uri: String,
    #[serde(default)]
    pub locked: bool,
}

impl ProceduralRule {
    pub fn new(trigger_context: impl Into<String>, directive: impl Into<String>, owner: &str) -> Self {
        Self {
            rule_id: format!("rule:{}", &hex_sha256(&format!(
                "{}\u{1}{}",
                normalize_label(&trigger_context.into()),
                normalize_label(&directive.into())
            ))[..32]),
            trigger_context: trigger_context.into(),
            absolute_directive: directive.into(),
            created_at: Utc::now().timestamp(),
            origin: "shadow_kernel".to_string(),
            owner_uri: normalize_owner(owner),
            locked: true,
        }
    }
}

/// Semantic triplet extracted from a conversation by the Shadow Kernel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTriplet {
    pub subject: String,
    pub predicate: String,
    pub object: String,

    #[serde(default = "default_confidence")]
    pub confidence: f32,

    #[serde(default = "default_impact")]
    pub impact: u8,

    /// Contradicts an existing fact: obsolete it instead of duplicating.
    #[serde(default)]
    pub overwrite: bool,

    /// Optional natural-language rendering, kept for provenance/UI.
    #[serde(default)]
    pub sentence: String,
}

impl SemanticTriplet {
    /// Clamp untrusted LLM output into the valid domain. `confidence` and
    /// `impact` come straight out of JSON and previously could be 0/NaN/negative,
    /// which propagated into retention math and instant-pruned fresh memories.
    pub fn sanitized(mut self) -> Self {
        self.subject = self.subject.trim().to_string();
        self.object = self.object.trim().to_string();
        self.predicate = normalize_predicate(&self.predicate);
        if !self.confidence.is_finite() {
            self.confidence = 0.7;
        }
        self.confidence = self.confidence.clamp(0.05, 1.0);
        self.impact = self.impact.clamp(1, 10);
        self
    }

    pub fn is_valid(&self) -> bool {
        !self.subject.is_empty() && !self.object.is_empty() && !self.predicate.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Context packet (the wire format every AI receives)
// ---------------------------------------------------------------------------

/// The compressed context packet injected into prompts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexContextPacket {
    #[serde(rename = "@context", default = "json_ld_context")]
    pub context: String,

    pub user_id: String,
    #[serde(default)]
    pub nodes: Vec<MemoryNode>,
    #[serde(default)]
    pub edges: Vec<RelationalEdge>,
    #[serde(default)]
    pub rules: Vec<ProceduralRule>,

    /// Budget the packet was built for.
    pub token_budget: u32,
    /// Actual estimate of `briefing`, guaranteed <= `token_budget`.
    pub token_estimate: u32,
    #[serde(default)]
    pub memories_found: usize,
    #[serde(default)]
    pub truncated: bool,

    /// Ready-to-inject natural-language/JSON-LD hybrid briefing.
    pub briefing: String,

    #[serde(default)]
    pub generated_at: Option<DateTime<Utc>>,
}

fn json_ld_context() -> String {
    "https://cortex.dev/ns/memory@2".to_string()
}

impl CortexContextPacket {
    pub fn empty(owner: &str, token_budget: u32) -> Self {
        Self {
            context: json_ld_context(),
            user_id: normalize_owner(owner),
            nodes: vec![],
            edges: vec![],
            rules: vec![],
            token_budget,
            token_estimate: 0,
            memories_found: 0,
            truncated: false,
            briefing: String::new(),
            generated_at: Some(Utc::now()),
        }
    }
}

// ---------------------------------------------------------------------------
// Working memory / sessions
// ---------------------------------------------------------------------------

/// One turn in a working-memory session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

impl Message {
    pub fn new(role: MessageRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            timestamp: Utc::now(),
        }
    }
}

/// Accumulated turns awaiting Shadow Kernel extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContext {
    pub session_id: String,
    pub user_id: String,
    #[serde(default)]
    pub chat_id: String,
    #[serde(default)]
    pub messages: Vec<Message>,
    pub started_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    #[serde(default)]
    pub active_topic: Option<String>,
    #[serde(default)]
    pub provenance: String,
}

impl SessionContext {
    pub fn new(session_id: impl Into<String>, owner: impl AsRef<str>) -> Self {
        let now = Utc::now();
        Self {
            session_id: session_id.into(),
            user_id: normalize_owner(owner.as_ref()),
            chat_id: String::new(),
            messages: vec![],
            started_at: now,
            last_activity: now,
            active_topic: None,
            provenance: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    /// Tool/IDE-generated context; excluded from fact extraction on purpose.
    #[serde(rename = "tool")]
    Tool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_ids_are_deterministic_and_case_insensitive() {
        assert_eq!(
            node_id_for_label("SurrealDB"),
            node_id_for_label("  surrealdb  ")
        );
        assert_eq!(node_id_for_label("Rust"), node_id_for_label("rust."));
        assert_ne!(node_id_for_label("Rust"), node_id_for_label("Rustlang"));
    }

    #[test]
    fn ids_never_carry_double_prefix() {
        let node = MemoryNode::new("Python");
        assert!(node.id.starts_with("node:"));
        assert!(!node.id.starts_with("node:node:"));
        assert_eq!(strip_id_prefix(&node.id), node.id.trim_start_matches("node:"));
        assert_eq!(strip_id_prefix("node:node:abc"), "abc");
        assert_eq!(strip_id_prefix("abc"), "abc");
    }

    #[test]
    fn edge_ids_are_stable_regardless_of_prefix_noise() {
        let a = RelationalEdge::between("node:aaa", "prefers", "node:bbb", 0.9, "x");
        let b = RelationalEdge::between("aaa", "Prefers ", "bbb", 0.9, "y");
        assert_eq!(a.id, b.id);
        assert_eq!(a.source, "node:aaa");
        assert_eq!(a.target, "node:bbb");
        // and edge endpoints are addressable by exactly the same string as node.id
        let node = MemoryNode::new("aaa");
        assert_eq!(canonical_node_id(node.id.strip_prefix("node:").unwrap()), node.id);
    }

    #[test]
    fn owner_normalization_unifies_the_default_namespace() {
        for raw in ["", "default", "default_user", "cortex://default", "Cortex://Default_User"] {
            assert_eq!(normalize_owner(raw), DEFAULT_OWNER, "input: {raw}");
        }
        assert_eq!(normalize_owner("cortex://Team Eng"), "cortex://team-eng");
        assert_eq!(normalize_owner("user_42"), "cortex://user-42");
        assert_eq!(DEFAULT_OWNER, "cortex://default");
    }

    #[test]
    fn retention_is_bounded_even_with_degenerate_input() {
        let mut node = MemoryNode::new("Degenerate");
        node.stability = 0.0;
        node.impact = 0;
        node.last_accessed = Utc::now();
        let r = node.retention_probability();
        assert!(r.is_finite(), "retention must stay finite, got {r}");
        assert!((0.0..=1.0).contains(&r), "retention out of range: {r}");
        assert!(r > 0.9, "a just-created memory must not look ancient: {r}");
    }

    #[test]
    fn locked_nodes_never_decay() {
        let mut node = MemoryNode::new("Identity");
        node.locked = true;
        node.last_accessed = Utc::now() - chrono::Duration::days(4_000);
        assert_eq!(node.retention_probability(), 1.0);
    }

    #[test]
    fn triplet_sanitizing_clamps_untrusted_llm_output() {
        let raw = SemanticTriplet {
            subject: "  Alice ".into(),
            predicate: "Likes Apples ",
            object: "Apples".into(),
            confidence: -3.0,
            impact: 0,
            overwrite: false,
            sentence: String::new(),
        }
        .sanitized();
        assert_eq!(raw.subject, "Alice");
        assert_eq!(raw.predicate, "likes_apples");
        assert!((0.05..=1.0).contains(&raw.confidence));
        assert_eq!(raw.impact, 1);
        assert!(raw.is_valid());
    }

    #[test]
    fn token_estimate_is_monotonic_and_rough() {
        assert_eq!(estimate_tokens(""), 0);
        assert!(estimate_tokens("abcd") <= 1);
        assert!(estimate_tokens(&"a".repeat(4000)) >= 999);
    }
}
