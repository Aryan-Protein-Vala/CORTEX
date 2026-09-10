//! Backend-agnostic graph store used by the API layer.
//!
//! `File` is the default and needs no infrastructure. `Surreal` is opt-in for
//! deployments that want the real graph engine. Both implement exactly the same
//! id/owner contract (see `crate::types`), so behaviour cannot diverge.

use crate::storage::graph_db::GraphMemory;
use crate::storage::store::FileGraphStore;
use crate::types::{MemoryNode, RelationalEdge};
use anyhow::Result;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Clone)]
pub enum GraphStore {
    File(Arc<FileGraphStore>),
    Surreal(Arc<GraphMemory>),
}

impl GraphStore {
    pub fn backend_name(&self) -> &'static str {
        match self {
            Self::File(_) => "file",
            Self::Surreal(_) => "surrealdb",
        }
    }

    /// Cheap liveness probe for `/health`. The file backend is healthy iff the
    /// directory is writable, which is the failure mode that actually happens.
    pub async fn ping(&self) -> bool {
        match self {
            Self::File(store) => {
                let probe = store.path().with_extension("health-probe");
                let ok = tokio::fs::write(&probe, b"ok").await.is_ok();
                if ok {
                    let _ = tokio::fs::remove_file(&probe).await;
                }
                ok
            }
            Self::Surreal(db) => db.ping().await.is_ok(),
        }
    }

    pub async fn upsert_node(&self, node: &MemoryNode) -> Result<bool> {
        match self {
            Self::File(s) => s.upsert_node(node).await,
            Self::Surreal(s) => s.upsert_node(node).await,
        }
    }

    pub async fn upsert_edge(&self, edge: &RelationalEdge) -> Result<bool> {
        match self {
            Self::File(s) => s.upsert_edge(edge).await,
            Self::Surreal(s) => s.upsert_edge(edge).await,
        }
    }

    /// One-write batch insert (keeps file persistence O(1) per ingest).
    pub async fn apply_batch(
        &self,
        nodes: Vec<MemoryNode>,
        edges: Vec<RelationalEdge>,
    ) -> Result<(usize, usize)> {
        match self {
            Self::File(s) => s.apply_batch(nodes, edges).await,
            Self::Surreal(s) => {
                let mut new_nodes = 0;
                for node in nodes {
                    if s.upsert_node(&node).await? {
                        new_nodes += 1;
                    }
                }
                let mut new_edges = 0;
                for edge in edges {
                    if s.upsert_edge(&edge).await? {
                        new_edges += 1;
                    }
                }
                Ok((new_nodes, new_edges))
            }
        }
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<MemoryNode>> {
        match self {
            Self::File(s) => s.get_node(id).await,
            Self::Surreal(s) => s.get_node(id).await,
        }
    }

    pub async fn find_node_by_label(&self, label: &str) -> Result<Option<MemoryNode>> {
        match self {
            Self::File(s) => s.find_node_by_label(label).await,
            Self::Surreal(s) => s.find_node_by_label(label).await,
        }
    }

    pub async fn list_nodes_for_owner(&self, owner: &str, limit: usize) -> Result<Vec<MemoryNode>> {
        match self {
            Self::File(s) => s.list_nodes_for_owner(owner, limit).await,
            Self::Surreal(s) => s.list_nodes_for_owner(owner, limit).await,
        }
    }

    pub async fn all_nodes(&self) -> Result<Vec<MemoryNode>> {
        match self {
            Self::File(s) => s.all_nodes().await,
            Self::Surreal(s) => s.get_all_nodes().await,
        }
    }

    pub async fn all_edges(&self) -> Result<Vec<RelationalEdge>> {
        match self {
            Self::File(s) => s.all_edges().await,
            Self::Surreal(s) => s.get_all_edges().await,
        }
    }

    pub async fn edges_for_nodes(
        &self,
        node_ids: &HashSet<String>,
        owner: Option<&str>,
    ) -> Result<Vec<RelationalEdge>> {
        match self {
            Self::File(s) => s.edges_for_nodes(node_ids, owner).await,
            Self::Surreal(s) => s.edges_for_nodes(node_ids, owner).await,
        }
    }

    pub async fn delete_node(&self, id: &str) -> Result<bool> {
        match self {
            Self::File(s) => s.delete_node(id).await,
            Self::Surreal(s) => s.delete_node(id).await,
        }
    }

    pub async fn delete_edge(&self, id: &str) -> Result<bool> {
        match self {
            Self::File(s) => s.delete_edge(id).await,
            Self::Surreal(s) => s.delete_edge(id).await,
        }
    }

    pub async fn set_node_locked(&self, id: &str, locked: bool) -> Result<Option<MemoryNode>> {
        match self {
            Self::File(s) => s.set_node_locked(id, locked).await,
            Self::Surreal(s) => s.set_node_locked(id, locked).await,
        }
    }

    pub async fn set_edge_locked(&self, id: &str, locked: bool) -> Result<Option<RelationalEdge>> {
        match self {
            Self::File(s) => s.set_edge_locked(id, locked).await,
            Self::Surreal(s) => s.set_edge_locked(id, locked).await,
        }
    }

    pub async fn counts(&self) -> Result<(usize, usize)> {
        match self {
            Self::File(s) => s.counts().await,
            Self::Surreal(s) => s.counts().await,
        }
    }
}
