//! Ebbinghaus decay, expressed as a *policy*, not an unconditional delete.
//!
//! Rationale: a memory product that silently forgets facts is worse than a
//! dumb one — users tolerate imperfect recall, never invisible data loss. The
//! default policy therefore scores and fades; pruning is opt-in.

use crate::storage::graph_store::GraphStore;
use crate::types::{MemoryNode, RelationalEdge};
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;

/// What to do with memories whose retention falls below the threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DecayPolicy {
    /// Never mutate. Retention still informs ranking (safest; default).
    Off,
    /// Flag as faded and depress edge weights. Nothing is deleted.
    #[default]
    Soft,
    /// Hard-delete sub-threshold nodes/edges. Explicit opt-in only.
    Prune,
}

impl DecayPolicy {
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "prune" | "delete" | "hard" => Self::Prune,
            "off" | "none" | "rank-only" => Self::Off,
            _ => Self::Soft,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Soft => "soft",
            Self::Prune => "prune",
        }
    }
}

/// Nodes below this retention are considered faded.
pub const FADE_THRESHOLD: f32 = 0.25;
/// Nodes below this retention are prunable (only under [`DecayPolicy::Prune`]).
pub const PRUNE_THRESHOLD: f32 = 0.05;

#[derive(Debug, Clone, Serialize, Default)]
pub struct SweepReport {
    pub policy: String,
    pub evaluated_nodes: usize,
    pub evaluated_edges: usize,
    pub faded_nodes: usize,
    pub depressed_edges: usize,
    /// Deletions actually confirmed by the store. Never estimated.
    pub pruned_nodes: usize,
    pub pruned_edges: usize,
    /// Locked/identity facts deliberately protected from decay.
    pub protected_nodes: usize,
}

#[derive(Debug, Clone, Default)]
pub struct SweepPlan {
    pub fade_node_ids: Vec<String>,
    pub keep_node_ids: Vec<String>,
    pub prune_node_ids: Vec<String>,
    pub depress_edge_ids: Vec<String>,
    pub prune_edge_ids: Vec<String>,
}

pub struct DecayEngine {
    pub policy: DecayPolicy,
}

impl Default for DecayEngine {
    fn default() -> Self {
        Self::with_policy(DecayPolicy::Soft)
    }
}

impl DecayEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_policy(policy: DecayPolicy) -> Self {
        Self { policy }
    }

    /// Pure scoring step: given a batch of nodes, decide what faded/prunes.
    /// Locked nodes are excluded from every destructive set by construction.
    pub fn plan_nodes(&self, nodes: &[MemoryNode]) -> SweepPlan {
        let mut plan = SweepPlan::default();
        for node in nodes {
            if node.locked {
                plan.keep_node_ids.push(node.id.clone());
                continue;
            }
            let retention = node.retention_probability();
            if retention < PRUNE_THRESHOLD {
                match self.policy {
                    DecayPolicy::Prune => plan.prune_node_ids.push(node.id.clone()),
                    _ => plan.fade_node_ids.push(node.id.clone()),
                }
            } else if retention < FADE_THRESHOLD && self.policy != DecayPolicy::Off {
                plan.fade_node_ids.push(node.id.clone());
            }
        }
        plan
    }

    /// Edge-level depression/pruning driven by endpoint retention.
    pub fn plan_edges(
        &self,
        edges: &[RelationalEdge],
        node_retentions: &HashMap<String, f32>,
    ) -> (Vec<String>, Vec<String>) {
        let mut depress = Vec::new();
        let mut prune = Vec::new();

        for edge in edges {
            if edge.locked {
                continue;
            }
            // An unknown endpoint must never be treated as retention 1.0: that
            // made dangling edges immortal. Missing = already forgotten.
            let source_r = node_retentions.get(&edge.source).copied();
            let target_r = node_retentions.get(&edge.target).copied();

            let lowest = match (source_r, target_r) {
                (Some(a), Some(b)) => a.min(b),
                (None, _) | (_, None) => 0.0,
            };

            if lowest < PRUNE_THRESHOLD {
                if self.policy == DecayPolicy::Prune {
                    prune.push(edge.id.clone());
                }
            } else if lowest < FADE_THRESHOLD && self.policy != DecayPolicy::Off {
                depress.push(edge.id.clone());
            }
        }

        (depress, prune)
    }

    /// Runs a full sweep against the live store and returns honest counts.
    pub async fn sweep(&self, store: &GraphStore) -> Result<SweepReport> {
        let nodes = store.all_nodes().await.unwrap_or_default();
        let edges = store.all_edges().await.unwrap_or_default();

        let mut retentions: HashMap<String, f32> = HashMap::with_capacity(nodes.len());
        let mut faded_nodes = 0usize;
        let mut protected = 0usize;

        let plan = self.plan_nodes(&nodes);
        let to_fade: std::collections::HashSet<String> =
            plan.fade_node_ids.clone().into_iter().collect();

        let mut updated_nodes: Vec<MemoryNode> = Vec::new();
        for node in &nodes {
            if node.locked {
                protected += 1;
            }
            retentions.insert(node.id.clone(), node.retention_probability());

            let should_be_fading = to_fade.contains(&node.id) && !node.fading;
            let should_be_lively =
                !to_fade.contains(&node.id) && node.fading && self.policy != DecayPolicy::Off;
            if should_be_fading || should_be_lively {
                let mut patched = node.clone();
                patched.fading = should_be_fading;
                updated_nodes.push(patched);
                if should_be_fading {
                    faded_nodes += 1;
                }
            }
        }

        let (depress_ids, pruned_edge_candidates) = self.plan_edges(&edges, &retentions);
        let depress: std::collections::HashSet<String> = depress_ids.into_iter().collect();

        let mut updated_edges: Vec<RelationalEdge> = Vec::new();
        let mut depressed_edges = 0usize;
        if !depress.is_empty() {
            for edge in &edges {
                if depress.contains(&edge.id) {
                    let mut patched = edge.clone();
                    patched.apply_depression(0.10);
                    updated_edges.push(patched);
                    depressed_edges += 1;
                }
            }
        }

        // Write the batch first, then delete — deleting first could orphan the
        // very edges we just scored.
        let (mut pruned_nodes, mut pruned_edges) = (0usize, 0usize);
        if !updated_nodes.is_empty() || !updated_edges.is_empty() {
            store.apply_batch(updated_nodes, updated_edges).await?;
        }

        if self.policy == DecayPolicy::Prune {
            for id in &plan.prune_node_ids {
                if store.delete_node(id).await? {
                    pruned_nodes += 1;
                }
            }
            for id in &pruned_edge_candidates {
                if store.delete_edge(id).await? {
                    pruned_edges += 1;
                }
            }
        }

        Ok(SweepReport {
            policy: self.policy.as_str().to_string(),
            evaluated_nodes: nodes.len(),
            evaluated_edges: edges.len(),
            faded_nodes,
            depressed_edges,
            pruned_nodes,
            pruned_edges,
            protected_nodes: protected,
        })
    }

    // ---- backwards-compatible helpers (used by existing tests) -------------

    /// Retention below the prune threshold. Kept for API stability with the
    /// previous behaviour; the engine's real path is [`DecayEngine::plan_nodes`].
    pub fn process_nodes_sweep(&self, nodes: &mut [MemoryNode]) -> Vec<String> {
        nodes
            .iter_mut()
            .filter(|n| !n.locked)
            .filter(|n| n.retention_probability() < PRUNE_THRESHOLD)
            .map(|n| n.id.clone())
            .collect()
    }

    pub fn process_edges_sweep(
        &self,
        edges: &mut [RelationalEdge],
        node_retentions: &HashMap<String, f32>,
    ) -> Vec<String> {
        let mut to_prune = Vec::new();
        for edge in edges.iter_mut() {
            let source_r = node_retentions.get(&edge.source).copied().unwrap_or(0.0);
            let target_r = node_retentions.get(&edge.target).copied().unwrap_or(0.0);
            if source_r < PRUNE_THRESHOLD || target_r < PRUNE_THRESHOLD {
                to_prune.push(edge.id.clone());
                continue;
            }
            if source_r < FADE_THRESHOLD || target_r < FADE_THRESHOLD {
                edge.apply_depression(0.10);
                if edge.weight < 0.01 {
                    to_prune.push(edge.id.clone());
                }
            }
        }
        to_prune
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn aged(label: &str, days: i64, locked: bool) -> MemoryNode {
        let mut node = MemoryNode::new(label);
        node.last_accessed = chrono::Utc::now() - Duration::days(days);
        node.locked = locked;
        node
    }

    #[test]
    fn soft_policy_fades_but_never_deletes() {
        let engine = DecayEngine::with_policy(DecayPolicy::Soft);
        let nodes = vec![aged("Fresh", 0, false), aged("Ancient junk", 365, false)];
        let plan = engine.plan_nodes(&nodes);
        assert!(plan.prune_node_ids.is_empty(), "soft policy must not prune");
        assert_eq!(plan.fade_node_ids.len(), 1);
        assert!(plan.fade_node_ids[0].starts_with("node:"));
    }

    #[test]
    fn off_policy_touches_nothing() {
        let engine = DecayEngine::with_policy(DecayPolicy::Off);
        let nodes = vec![aged("Ancient junk", 3650, false)];
        let plan = engine.plan_nodes(&nodes);
        assert!(plan.fade_node_ids.is_empty());
        assert!(plan.prune_node_ids.is_empty());
    }

    #[test]
    fn prune_policy_is_explicit() {
        let engine = DecayEngine::with_policy(DecayPolicy::Prune);
        let nodes = vec![aged("Ancient junk", 365, false)];
        assert_eq!(engine.plan_nodes(&nodes).prune_node_ids.len(), 1);
    }

    #[test]
    fn locked_identity_facts_are_immune_to_every_policy() {
        for policy in [DecayPolicy::Off, DecayPolicy::Soft, DecayEngine::new().policy] {
            let engine = DecayEngine::with_policy(policy);
            let nodes = vec![aged("I am a developer", 3_000, true)];
            let plan = engine.plan_nodes(&nodes);
            assert!(plan.prune_node_ids.is_empty());
            assert!(plan.fade_node_ids.is_empty());
            assert_eq!(plan.keep_node_ids.len(), 1);
        }
    }

    #[test]
    fn dangling_edges_are_prunable_not_immortal() {
        let engine = DecayEngine::with_policy(DecayPolicy::Prune);
        let edge = RelationalEdge::new("node:ghost", "relates_to", "node:gone", 0.9);
        let retentions = HashMap::new(); // both endpoints unknown
        let (_, prune) = engine.plan_edges(std::slice::from_ref(&edge), &retentions);
        assert_eq!(prune.len(), 1, "edge to a deleted node must not live forever");
    }

    #[test]
    fn policy_parsing_is_lenient() {
        assert_eq!(DecayPolicy::parse("  PRUNE "), DecayPolicy::Prune);
        assert_eq!(DecayPolicy::parse("off"), DecayPolicy::Off);
        assert_eq!(DecayPolicy::parse(""), DecayPolicy::Soft);
        assert_eq!(DecayPolicy::parse("whatever"), DecayPolicy::Soft);
    }
}
