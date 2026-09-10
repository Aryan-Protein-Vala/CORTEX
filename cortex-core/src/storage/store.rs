//! Zero-infrastructure graph store: an append-safe JSON file plus an in-memory
//! index. This is the default backend so `cortex-core` runs as a single binary
//! with no Docker, no SurrealDB, no Qdrant and no Redis.
//!
//! Guarantees:
//! * atomic durability via write-temp + rename (no torn files on power loss);
//! * every mutation is a `MERGE`-style upsert keyed by deterministic ids, so
//!   re-ingesting the same fact reinforces rather than duplicates;
//! * single-writer semantics through one `tokio::sync::Mutex`.
//!
//! Documented limits (fine for a personal graph, not for multi-tenant SaaS):
//! whole-file rewrite per mutation batch and O(nodes) scans. See `FIXES.md`.

use crate::types::{canonical_node_id, normalize_owner, MemoryNode, RelationalEdge};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Default, Serialize, Deserialize)]
struct FileData {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    nodes: HashMap<String, MemoryNode>,
    #[serde(default)]
    edges: HashMap<String, RelationalEdge>,
}

#[derive(Clone)]
pub struct FileGraphStore {
    path: Arc<PathBuf>,
    data: Arc<Mutex<FileData>>,
}

impl FileGraphStore {
    /// Loads the store, creating the parent directory when missing. A corrupt
    /// file is preserved as `cortex-graph.json.corrupt-<ts>` rather than
    /// silently truncated, so a bad disk state never destroys a user's memory.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .with_context(|| format!("creating data dir {}", parent.display()))?;
            }
        }

        let data = match tokio::fs::read_to_string(&path).await {
            Ok(raw) if raw.trim().is_empty() => FileData::default(),
            Ok(raw) => serde_json::from_str::<FileData>(&raw).unwrap_or_else(|err| {
                eprintln!(
                    "⚠️  graph file {} is unreadable ({err}); salvaging a backup copy",
                    path.display()
                );
                let salvage = format!(
                    "{}.corrupt-{}",
                    path.display(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0)
                );
                if let Err(e) = std::fs::copy(&path, &salvage) {
                    eprintln!("⚠️  could not write salvage copy: {e}");
                }
                FileData::default()
            }),
            Err(_) => FileData::default(),
        };

        Ok(Self {
            path: Arc::new(path),
            data: Arc::new(Mutex::new(data)),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    async fn persist(&self, data: &FileData) -> Result<()> {
        let mut payload = serde_json::to_vec(data).context("serializing graph")?;
        payload.push(b'\n');

        let tmp = {
            let mut name = self
                .path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "cortex-graph.json".to_string());
            name.push_str(".tmp");
            self.path.with_file_name(name)
        };

        tokio::fs::write(&tmp, &payload)
            .await
            .with_context(|| format!("writing {}", tmp.display()))?;
        tokio::fs::rename(&tmp, &self.path)
            .await
            .with_context(|| format!("renaming {} -> {}", tmp.display(), self.path.display()))?;
        Ok(())
    }

    /// Inserts or reinforces a node. Returns `true` when the node is new.
    pub async fn upsert_node(&self, node: &MemoryNode) -> Result<bool> {
        let mut data = self.data.lock().await;
        let created = !data.nodes.contains_key(node.id.as_str());
        data.nodes.insert(node.id.clone(), node.clone());
        self.persist(&data).await?;
        Ok(created)
    }

    pub async fn upsert_edge(&self, edge: &RelationalEdge) -> Result<bool> {
        let mut data = self.data.lock().await;
        let created = !data.edges.contains_key(edge.id.as_str());
        data.edges.insert(edge.id.clone(), edge.clone());
        self.persist(&data).await?;
        Ok(created)
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<MemoryNode>> {
        let data = self.data.lock().await;
        Ok(data.nodes.get(canonical_node_id(id).as_str()).cloned())
    }

    /// Exact-match label lookup using the deterministic id (no index needed).
    pub async fn find_node_by_label(&self, label: &str) -> Result<Option<MemoryNode>> {
        let id = crate::types::node_id_for_label(label);
        self.get_node(&id).await
    }

    pub async fn list_nodes_for_owner(&self, owner: &str, limit: usize) -> Result<Vec<MemoryNode>> {
        let owner = normalize_owner(owner);
        let data = self.data.lock().await;
        let mut out: Vec<MemoryNode> = data
            .nodes
            .values()
            .filter(|n| normalize_owner(&n.owner_uri) == owner)
            .cloned()
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out.truncate(limit);
        Ok(out)
    }

    pub async fn all_nodes(&self) -> Result<Vec<MemoryNode>> {
        let data = self.data.lock().await;
        Ok(data.nodes.values().cloned().collect())
    }

    pub async fn all_edges(&self) -> Result<Vec<RelationalEdge>> {
        let data = self.data.lock().await;
        Ok(data.edges.values().cloned().collect())
    }

    pub async fn edges_for_nodes(&self, node_ids: &HashSet<String>, owner: Option<&str>) -> Result<Vec<RelationalEdge>> {
        let owner = owner.map(normalize_owner);
        let data = self.data.lock().await;
        Ok(data
            .edges
            .values()
            .filter(|e| {
                let touches = node_ids.contains(e.source.as_str()) || node_ids.contains(e.target.as_str());
                let owned = match &owner {
                    Some(o) => normalize_owner(&e.owner_uri) == *o,
                    None => true,
                };
                touches && owned
            })
            .cloned()
            .collect())
    }

    pub async fn delete_node(&self, id: &str) -> Result<bool> {
        let canon = canonical_node_id(id);
        let mut data = self.data.lock().await;
        let removed = data.nodes.remove(canon.as_str()).is_some();
        if removed {
            // Cascade: an edge pointing at a deleted node is a dangling
            // reference that would otherwise resurface as `node:<uuid>` noise.
            let dangling: Vec<String> = data
                .edges
                .iter()
                .filter(|(_, e)| e.source == canon || e.target == canon)
                .map(|(k, _)| k.clone())
                .collect();
            for key in dangling {
                data.edges.remove(&key);
            }
            self.persist(&data).await?;
        }
        Ok(removed)
    }

    pub async fn delete_edge(&self, id: &str) -> Result<bool> {
        let bare = crate::types::strip_id_prefix(id);
        let mut data = self.data.lock().await;
        let removed = data.edges.remove(bare.as_str()).is_some();
        if removed {
            self.persist(&data).await?;
        }
        Ok(removed)
    }

    pub async fn set_node_locked(&self, id: &str, locked: bool) -> Result<Option<MemoryNode>> {
        let canon = canonical_node_id(id);
        let mut data = self.data.lock().await;
        let updated = match data.nodes.get_mut(canon.as_str()) {
            Some(node) => {
                node.locked = locked;
                node.updated_at = chrono::Utc::now();
                Some(node.clone())
            }
            None => None,
        };
        if updated.is_some() {
            self.persist(&data).await?;
        }
        Ok(updated)
    }

    pub async fn set_edge_locked(&self, id: &str, locked: bool) -> Result<Option<RelationalEdge>> {
        let bare = crate::types::strip_id_prefix(id);
        let mut data = self.data.lock().await;
        let updated = match data.edges.get_mut(bare.as_str()) {
            Some(edge) => {
                edge.locked = locked;
                Some(edge.clone())
            }
            None => None,
        };
        if updated.is_some() {
            self.persist(&data).await?;
        }
        Ok(updated)
    }

    /// Bulk mutation used by the batch upserter, in one write.
    pub async fn apply_batch(
        &self,
        nodes: Vec<MemoryNode>,
        edges: Vec<RelationalEdge>,
    ) -> Result<(usize, usize)> {
        let mut data = self.data.lock().await;
        let mut n = 0usize;
        let mut e = 0usize;
        for node in nodes {
            if !data.nodes.contains_key(node.id.as_str()) {
                n += 1;
            }
            data.nodes.insert(node.id.clone(), node);
        }
        for edge in edges {
            if !data.edges.contains_key(edge.id.as_str()) {
                e += 1;
            }
            data.edges.insert(edge.id.clone(), edge);
        }
        self.persist(&data).await?;
        Ok((n, e))
    }

    pub async fn counts(&self) -> Result<(usize, usize)> {
        let data = self.data.lock().await;
        Ok((data.nodes.len(), data.edges.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{node_id_for_label, RelationalEdge};

    fn tmp_path(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "cortex-store-{}-{}-{}.json",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        p
    }

    #[tokio::test]
    async fn roundtrip_persists_across_reopen() {
        let path = tmp_path("roundtrip");
        let store = FileGraphStore::open(&path).await.unwrap();
        let mut node = MemoryNode::with_owner("SurrealDB", "cortex://default");
        node.impact = 9;
        assert!(store.upsert_node(&node).await.unwrap());
        // second write of the same node is an update, not a duplicate
        assert!(!store.upsert_node(&node).await.unwrap());
        drop(store);

        let reopened = FileGraphStore::open(&path).await.unwrap();
        let loaded = reopened.get_node(&node.id).await.unwrap().expect("node survived");
        assert_eq!(loaded.label, "SurrealDB");
        assert_eq!(loaded.impact, 9);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn label_lookup_uses_the_same_id_contract_as_writes() {
        // The exact class of bug this rewrite exists to prevent: writes and
        // reads must agree on the id, or recall silently returns nothing.
        let path = tmp_path("contract");
        let store = FileGraphStore::open(&path).await.unwrap();
        let node = MemoryNode::with_owner("Always use Tailwind v4", "default_user");
        store.upsert_node(&node).await.unwrap();

        assert_eq!(node.id, node_id_for_label("Always use Tailwind v4"));
        let by_label = store
            .find_node_by_label("always use tailwind v4")
            .await
            .unwrap()
            .expect("must find what we just wrote");
        assert_eq!(by_label.id, node.id);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn delete_reports_truth_and_cascades_edges() {
        let path = tmp_path("delete");
        let store = FileGraphStore::open(&path).await.unwrap();
        let a = MemoryNode::with_owner("Alice", "cortex://default");
        let b = MemoryNode::with_owner("Bob", "cortex://default");
        store.upsert_node(&a).await.unwrap();
        store.upsert_node(&b).await.unwrap();
        let edge = RelationalEdge::between(&a.id, "manages", &b.id, 0.9, "cortex://default");
        store.upsert_edge(&edge).await.unwrap();

        assert!(store.delete_node(&a.id).await.unwrap());
        assert!(!store.delete_node(&a.id).await.unwrap(), "no phantom prune count");
        let edges = store.all_edges().await.unwrap();
        assert!(edges.is_empty(), "dangling edge must be cascaded away");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn owner_filtering_is_normalized_on_both_sides() {
        let path = tmp_path("owner");
        let store = FileGraphStore::open(&path).await.unwrap();
        let node = MemoryNode::with_owner("Rust", "default_user");
        store.upsert_node(&node).await.unwrap();
        // the dashboard queries `cortex://default`; the writer said `default_user`
        assert_eq!(store.list_nodes_for_owner("cortex://default", 10).await.unwrap().len(), 1);
        assert_eq!(store.list_nodes_for_owner("cortex://someone-else", 10).await.unwrap().len(), 0);
        let _ = std::fs::remove_file(&path);
    }
}
