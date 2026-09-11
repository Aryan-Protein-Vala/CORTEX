//! Recall: the read half of the product.
//!
//! Two deliberate design rules, both learned from the previous behaviour:
//! 1. **One scan, then walk in memory.** The old path did a per-hop DB query and
//!    deserialized `id` inconsistently, so recall always returned nothing. Now we
//!    load the (small) graph once and BFS it locally.
//! 2. **The token budget is enforced, not echoed.** The whole pitch is "context
//!    stays flat", so the packer hard-stops at the budget and reports `truncated`.
//!    Briefings are rendered with human labels — never raw record ids — because
//!    `node:9f3c… -> [prefers] -> node:1a07…` is useless to an LLM.

use crate::storage::graph_store::GraphStore;
use crate::types::{
    estimate_tokens, is_global_mesh, normalize_label, normalize_owner, MemoryNode, RelationalEdge,
    GLOBAL_MESH_OWNER,
};
use anyhow::Result;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

/// Model tag written into `embedding_model`. Recall only compares vectors that
/// carry the same tag, so switching (or losing) an embedding key degrades to
/// lexical scoring instead of mixing incompatible vector spaces.
pub const LOCAL_EMBEDDING_MODEL: &str = "cortex-local-128";

#[derive(Debug, Clone)]
pub struct RecallOptions {
    pub token_budget: u32,
    pub max_hops: u8,
    pub include_mesh: bool,
    pub seed_limit: usize,
    /// Cap on how many nodes are scanned into memory per recall.
    pub scan_limit: usize,
    pub include_briefing_debug: bool,
}

impl Default for RecallOptions {
    fn default() -> Self {
        Self {
            token_budget: 500,
            max_hops: 2,
            include_mesh: false,
            seed_limit: 8,
            scan_limit: 20_000,
            include_briefing_debug: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScoredNode {
    pub node: MemoryNode,
    pub score: f32,
    pub why: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecallOutcome {
    pub nodes: Vec<MemoryNode>,
    pub edges: Vec<RelationalEdge>,
    pub briefing: String,
    pub token_budget: u32,
    pub tokens_used: u32,
    pub memories_found: usize,
    pub truncated: bool,
    pub scanned: usize,
    pub owner_uri: String,
    pub debug: Vec<ScoredNode>,
}

impl RecallOutcome {
    fn empty(owner: &str, budget: u32) -> Self {
        Self {
            nodes: vec![],
            edges: vec![],
            briefing: String::new(),
            token_budget: budget,
            tokens_used: 0,
            memories_found: 0,
            truncated: false,
            scanned: 0,
            owner_uri: normalize_owner(owner),
            debug: vec![],
        }
    }
}

fn query_tokens(prompt: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    normalize_label(prompt)
        .split(' ')
        .filter(|t| t.len() >= 3)
        .filter(|t| seen.insert((*t).to_string()))
        .map(|t| t.to_string())
        .collect()
}

/// Scores every candidate node against the prompt.
pub fn score_nodes(
    prompt: &str,
    nodes: &[MemoryNode],
    query_embedding: &[f32],
    query_model: &str,
) -> Vec<ScoredNode> {
    let tokens = query_tokens(prompt);
    let mut scored: Vec<ScoredNode> = Vec::with_capacity(nodes.len());

    for node in nodes {
        let mut score = 0f32;
        let mut why: Vec<String> = Vec::new();

        let haystack = {
            let mut h = node.label_key.clone();
            for alias in &node.aliases {
                h.push(' ');
                h.push_str(&normalize_label(alias));
            }
            h
        };

        let mut hits = 0usize;
        for token in &tokens {
            if haystack.contains(token.as_str()) {
                hits += 1;
            }
        }
        if hits > 0 {
            let lexical = (hits as f32 / 2.0).min(1.0) * 0.6;
            score += lexical;
            why.push(format!("lexical:{hits}"));
        }

        if !node.embedding.is_empty()
            && !query_embedding.is_empty()
            && (node.embedding_model.is_empty() || node.embedding_model == query_model)
        {
            let sim = crate::storage::vector_db::cosine_similarity(query_embedding, &node.embedding);
            if sim > 0.05 {
                score += sim.min(1.0) * 0.5;
                why.push(format!("vector:{:.2}", sim));
            }
        }

        // Salience is a tie-breaker, not the driver: a stale-but-important fact
        // should still surface, a hot-but-irrelevant one should not.
        score += (node.salience() * 0.02).min(0.15);
        if node.locked {
            score += 0.35;
            why.push("locked".into());
        }
        if node.fading {
            score *= 0.6;
            why.push("fading".into());
        }
        if is_global_mesh(&node.owner_uri) {
            score += 0.05;
        }

        if score > 0.12 {
            scored.push(ScoredNode {
                node: node.clone(),
                score,
                why,
            });
        }
    }

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

/// Expands a seed set through the graph, bounded by hop count.
fn expand(
    seeds: &HashSet<String>,
    edges: &[RelationalEdge],
    index: &HashMap<String, &MemoryNode>,
    max_hops: u8,
    limit: usize,
) -> (HashSet<String>, Vec<RelationalEdge>) {
    let mut visited: HashSet<String> = seeds.clone();
    let mut queue: VecDeque<(String, u8)> = seeds.iter().cloned().map(|id| (id, 0)).collect();
    let mut used_edges: Vec<RelationalEdge> = Vec::new();
    let mut seen_edge_ids: HashSet<String> = HashSet::new();

    while let Some((current, hop)) = queue.pop_front() {
        if hop >= max_hops || visited.len() >= limit {
            continue;
        }
        for edge in edges {
            if edge.is_historical {
                continue;
            }
            let neighbour = if edge.source == current {
                Some(&edge.target)
            } else if edge.target == current {
                Some(&edge.source)
            } else {
                None
            };
            let Some(neighbour) = neighbour else { continue };
            if seen_edge_ids.insert(edge.id.clone()) {
                used_edges.push(edge.clone());
            }
            if !visited.contains(neighbour) && index.contains_key(neighbour) {
                visited.insert(neighbour.clone());
                queue.push_back((neighbour.clone(), hop + 1));
            }
        }
    }

    (visited, used_edges)
}

/// Renders the packet body and enforces the budget. Returns
/// `(briefing, tokens_used, truncated)`.
pub fn render_briefing(
    nodes: &[MemoryNode],
    edges: &[RelationalEdge],
    budget: u32,
) -> (String, u32, bool) {
    let budget = if budget == 0 { 500 } else { budget.min(4000) };
    let labels: HashMap<&str, &str> =
        nodes.iter().map(|n| (n.id.as_str(), n.label.as_str())).collect();
    // Endpoints are canonical node ids, so this is a single lookup with a
    // legacy-bare-id fallback; both forms resolve to the same label.
    let label_of = |id: &str| -> Option<&str> {
        if let Some(found) = labels.get(id).copied() {
            return Some(found);
        }
        let canon = crate::types::canonical_node_id(id);
        labels.get(canon.as_str()).copied()
    };

    let mut standing: Vec<String> = Vec::new();
    let mut facts: Vec<String> = Vec::new();
    let mut concepts: Vec<String> = Vec::new();

    for node in nodes {
        if node.locked {
            standing.push(format!("{} (core, never decays)", node.label));
        } else if node.fading {
            concepts.push(format!("{} [fading]", node.label));
        } else {
            concepts.push(node.label.clone());
        }
    }

    for edge in edges {
        let (Some(src), Some(tgt)) = (label_of(&edge.source), label_of(&edge.target)) else {
            // Never emit an id-only fact: it is noise that costs tokens.
            continue;
        };
        let qualifier = if edge.is_historical {
            " (superseded)"
        } else if edge.locked {
            " (rule)"
        } else {
            ""
        };
        facts.push(format!("{} -> [{}] -> {}{}", src, edge.predicate, tgt, qualifier));
    }

    let mut out = String::new();
    let mut used = 0u32;
    let mut truncated = false;

    let push = |line: &str, out: &mut String, used: &mut u32, truncated: &mut bool| -> bool {
        let candidate_len = estimate_tokens(&format!("{out}{line}\n"));
        if candidate_len > budget {
            *truncated = true;
            return false;
        }
        out.push_str(line);
        out.push('\n');
        *used = candidate_len;
        true
    };

    if !facts.is_empty() {
        let _ = push("CORTEX MEMORY / RELATIONS", &mut out, &mut used, &mut truncated);
        for line in facts.iter().take(120) {
            if !push(line, &mut out, &mut used, &mut truncated) {
                break;
            }
        }
    }
    if !standing.is_empty() {
        let _ = push("CORTEX MEMORY / CORE IDENTITY", &mut out, &mut used, &mut truncated);
        for line in standing.iter().take(40) {
            if !push(line, &mut out, &mut used, &mut truncated) {
                break;
            }
        }
    }
    if !concepts.is_empty() && used < budget.saturating_sub(16) {
        let _ = push("CORTEX MEMORY / CONCEPTS", &mut out, &mut used, &mut truncated);
        let mut line = String::new();
        for concept in concepts.iter().take(200) {
            let probe = if line.is_empty() {
                concept.clone()
            } else {
                format!("{line}, {concept}")
            };
            if estimate_tokens(&format!("{out}{probe}\n")) > budget {
                truncated = true;
                break;
            }
            line = probe;
        }
        if !line.is_empty() {
            let _ = push(&line, &mut out, &mut used, &mut truncated);
        }
    }

    (out.trim_end().to_string(), used, truncated)
}

/// Full recall pipeline against the live store.
pub async fn recall(
    store: &GraphStore,
    prompt: &str,
    owner: &str,
    opts: &RecallOptions,
    query_embedding: &[f32],
    query_model: &str,
) -> Result<RecallOutcome> {
    let owner = normalize_owner(owner);
    let want_owner = owner.clone();
    let want_mesh = opts.include_mesh;

    let all_nodes = store.all_nodes().await?;
    let scanned = all_nodes.len().min(opts.scan_limit);
    let scope: Vec<MemoryNode> = all_nodes
        .iter()
        .filter(|n| {
            let n_owner = normalize_owner(&n.owner_uri);
            n_owner == want_owner || (want_mesh && n_owner == GLOBAL_MESH_OWNER)
        })
        .take(opts.scan_limit)
        .cloned()
        .collect();

    if scope.is_empty() {
        return Ok(RecallOutcome::empty(&owner, opts.token_budget));
    }

    let scored = score_nodes(prompt, &scope, query_embedding, query_model);
    if scored.is_empty() {
        // Graph exists but nothing matches: still report that we scanned it, so
        // callers can distinguish "empty brain" from "no relevance" in the UI.
        let mut outcome = RecallOutcome::empty(&owner, opts.token_budget);
        outcome.scanned = scanned;
        outcome.debug = if opts.include_briefing_debug { scored } else { vec![] };
        return Ok(outcome);
    }

    let seeds: HashSet<String> = scored
        .iter()
        .take(opts.seed_limit)
        .map(|s| s.node.id.clone())
        .collect();

    let index: HashMap<String, MemoryNode> = scope
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    let ref_index: HashMap<String, &MemoryNode> = index.iter().map(|(k, v)| (k.clone(), v)).collect();

    let all_edges = store.all_edges().await?;
    let scoped_edges: Vec<RelationalEdge> = all_edges
        .iter()
        .filter(|e| {
            let e_owner = normalize_owner(&e.owner_uri);
            e_owner == want_owner || (want_mesh && e_owner == GLOBAL_MESH_OWNER)
        })
        .cloned()
        .collect();

    let (visited, walked_edges) = expand(
        &seeds,
        &scoped_edges,
        &ref_index,
        opts.max_hops,
        opts.seed_limit * 6,
    );

    let mut selected: Vec<MemoryNode> = visited
        .iter()
        .filter_map(|id| index.get(id))
        .cloned()
        .collect();
    // Locked identity facts are always included; they are the cheapest, highest
    // value context in the whole system.
    for s in scored.iter().take(opts.seed_limit) {
        if s.node.locked && !selected.iter().any(|n| n.id == s.node.id) {
            selected.push(s.node.clone());
        }
    }
    selected.sort_by(|a, b| {
        b.locked
            .cmp(&a.locked)
            .then(b.salience().partial_cmp(&a.salience()).unwrap_or(std::cmp::Ordering::Equal))
    });
    selected.truncate(400);

    let mut node_ids: HashSet<String> = HashSet::with_capacity(selected.len() * 2);
    for node in &selected {
        node_ids.insert(node.id.clone());
    }
    let final_edges: Vec<RelationalEdge> = walked_edges
        .into_iter()
        .filter(|e| {
            node_ids.contains(&e.source)
                && node_ids.contains(&e.target)
                && e.weight > 0.01
        })
        .collect();

    let (briefing, tokens_used, truncated) =
        render_briefing(&selected, &final_edges, opts.token_budget);

    let mut outcome = RecallOutcome {
        nodes: selected,
        edges: final_edges,
        briefing,
        token_budget: opts.token_budget,
        tokens_used,
        memories_found: 0,
        truncated,
        scanned,
        owner_uri: owner.clone(),
        debug: vec![],
    };
    outcome.memories_found = outcome.nodes.len() + outcome.edges.len();
    if opts.include_briefing_debug {
        outcome.debug = scored.into_iter().take(12).collect();
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(label: &str, owner: &str) -> MemoryNode {
        MemoryNode::with_owner(label, owner)
    }

    #[test]
    fn lexical_hit_beats_irrelevant_node() {
        let nodes = vec![node("SurrealDB", "cortex://default"), node("Cooking", "cortex://default")];
        let scored = score_nodes("which database do we use? surrealdb", &nodes, &[], "");
        assert!(!scored.is_empty());
        assert_eq!(scored[0].node.label, "SurrealDB");
    }

    #[test]
    fn locked_identity_always_surfaces() {
        let mut identity = node("User is a backend engineer", "cortex://default");
        identity.locked = true;
        let scored = score_nodes("totally unrelated query", &[identity.clone()], &[], "");
        assert!(
            scored.iter().any(|s| s.node.locked),
            "locked facts must not need a lexical match"
        );
    }

    #[test]
    fn briefing_renders_labels_never_ids() {
        let mut a = node("Alice", "cortex://default");
        let mut b = node("Acme Corp", "cortex://default");
        a.stability = 10.0;
        b.stability = 10.0;
        let edge = RelationalEdge::between(&a.id, "works_at", &b.id, 0.9, "cortex://default");
        let (text, used, _) = render_briefing(&[a, b], &[edge], 500);
        assert!(text.contains("Alice -> [works_at] -> Acme Corp"), "got: {text}");
        assert!(!text.contains("node:"), "ids must never leak into the packet: {text}");
        assert!(used > 0 && used < 500);
    }

    #[test]
    fn budget_is_actually_enforced() {
        // 500 nodes with long labels; the old code would have emitted all of them.
        let mut nodes = Vec::new();
        for i in 0..500 {
            nodes.push(node(&format!("A fairly long concept label number {i} that costs tokens"), "cortex://default"));
        }
        let (text, used, truncated) = render_briefing(&nodes, &[], 120);
        assert!(truncated, "must report truncation");
        assert!(used <= 120, "budget exceeded: {used}");
        assert!(
            estimate_tokens(&text) <= 121,
            "rendered text exceeds budget: {}",
            estimate_tokens(&text)
        );
    }

    #[test]
    fn id_only_edges_are_dropped_instead_of_bloating_the_prompt() {
        let a = node("Known", "cortex://default");
        let orphan = RelationalEdge::between(&a.id, "relates_to", "node:missing999", 0.9, "cortex://default");
        let (text, _, _) = render_briefing(&[a], &[orphan], 500);
        assert!(!text.contains("missing999"), "dangling id must not be injected: {text}");
    }

    #[test]
    fn historical_edges_are_marked_not_hidden() {
        let a = node("MongoDB", "cortex://default");
        let b = node("PostgreSQL", "cortex://default");
        let mut edge = RelationalEdge::between(&a.id, "replaced_by", &b.id, 0.1, "cortex://default");
        edge.is_historical = true;
        let (text, _, _) = render_briefing(&[a, b], &[edge], 500);
        assert!(text.contains("(superseded)"), "history must be labelled: {text}");
    }
}
