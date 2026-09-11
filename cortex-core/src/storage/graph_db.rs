//! Optional SurrealDB backend. Enabled with `CORTEX_SURREAL_URL`; the default
//! backend is the zero-infrastructure [`crate::storage::store::FileGraphStore`].
//!
//! Ids follow the single contract in [`crate::types`]: record keys are **bare**
//! (`("node", "9f3c…")`), and the field is persisted as `key`, so nothing ever
//! becomes `node:node:…` and every read matches the write.

use crate::types::{canonical_node_id, normalize_owner, strip_id_prefix, MemoryNode, RelationalEdge};
use anyhow::{Context, Result};
use surrealdb::engine::any::connect;
use surrealdb::engine::any::Any;
use surrealdb::opt::auth::Root;
use surrealdb::Surreal;

/// Explicit field list keeps deserialization independent of how the record's own
/// `id` (a record id, not a string) happens to serialize.
const NODE_FIELDS: &str = "key, label, label_key, aliases, stability, impact, locked, fading, category, owner_uri, provenance, created_at, updated_at, last_accessed, access_count, metadata, embedding, embedding_model";
const EDGE_FIELDS: &str = "key, source, target, predicate, weight, is_historical, confidence, impact, locked, owner_uri, provenance, created_at, last_reinforced, reinforcement_count";

pub struct GraphMemory {
    db: Surreal<Any>,
}

impl GraphMemory {
    pub async fn new(
        url: &str,
        user: &str,
        pass: &str,
        namespace: &str,
        database: &str,
    ) -> Result<Self> {
        let db = connect(url).await.context("Failed to connect to SurrealDB")?;

        db.signin(Root {
            username: user,
            password: pass,
        })
        .await
        .context("Failed to sign in to SurrealDB")?;

        db.use_ns(namespace)
            .use_db(database)
            .await
            .context("Failed to select namespace/database")?;

        Ok(Self { db })
    }

    /// Liveness probe used by `/health` (a constructed client is not proof).
    pub async fn ping(&self) -> Result<()> {
        let mut resp = self
            .db
            .query("SELECT 1 AS ok FROM true LIMIT 1;")
            .await
            .context("SurrealDB ping failed")?;
        let check: Vec<serde_json::Value> = resp.take(0)?;
        if check.is_empty() {
            anyhow::bail!("SurrealDB ping returned no rows");
        }
        Ok(())
    }

    /// Serializes the node without its `key` and writes it under the bare id.
    fn to_doc<T: serde::Serialize>(value: &T) -> Result<serde_json::Value> {
        let mut doc = serde_json::to_value(value).context("serializing record")?;
        if let Some(map) = doc.as_object_mut() {
            // `key` is the record id; keeping it in CONTENT is redundant but
            // harmless. `id` must never be present — that is what previously
            // collided with the record identifier.
            map.remove("id");
        }
        Ok(doc)
    }

    pub async fn upsert_node(&self, node: &MemoryNode) -> Result<bool> {
        let existed = self.get_node(&node.id).await?.is_some();
        let doc = Self::to_doc(node)?;
        let _: Option<MemoryNode> = self
            .db
            .update(("node", strip_id_prefix(&node.id).as_str()))
            .content(doc)
            .await
            .context("upsert_node")?;
        Ok(!existed)
    }

    pub async fn upsert_edge(&self, edge: &RelationalEdge) -> Result<bool> {
        let existed = self.get_edge(&edge.id).await?.is_some();
        let doc = Self::to_doc(edge)?;
        let _: Option<RelationalEdge> = self
            .db
            .update(("edge", strip_id_prefix(&edge.id).as_str()))
            .content(doc)
            .await
            .context("upsert_edge")?;
        Ok(!existed)
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<MemoryNode>> {
        let bare = canonical_node_id(id);
        let mut resp = self
            .db
            .query(format!("SELECT {} FROM node WHERE key = $key LIMIT 1;", NODE_FIELDS))
            .bind(("key", bare))
            .await
            .context("get_node")?;
        let rows: Vec<MemoryNode> = resp.take(0)?;
        Ok(rows.into_iter().next())
    }

    pub async fn get_edge(&self, id: &str) -> Result<Option<RelationalEdge>> {
        let bare = strip_id_prefix(id);
        let mut resp = self
            .db
            .query(format!("SELECT {} FROM edge WHERE key = $key LIMIT 1;", EDGE_FIELDS))
            .bind(("key", bare))
            .await
            .context("get_edge")?;
        let rows: Vec<RelationalEdge> = resp.take(0)?;
        Ok(rows.into_iter().next())
    }

    /// Exact label lookup via the deterministic id — no unique index required.
    pub async fn find_node_by_label(&self, label: &str) -> Result<Option<MemoryNode>> {
        let id = crate::types::node_id_for_label(label);
        self.get_node(&id).await
    }

    pub async fn list_nodes_for_owner(&self, owner: &str, limit: usize) -> Result<Vec<MemoryNode>> {
        let owner = normalize_owner(owner);
        let mut resp = self
            .db
            .query(format!(
                "SELECT {} FROM node WHERE owner_uri = $owner ORDER BY updated_at DESC LIMIT {};",
                NODE_FIELDS, limit
            ))
            .bind(("owner", owner))
            .await
            .context("list_nodes_for_owner")?;
        let rows: Vec<MemoryNode> = resp.take(0)?;
        Ok(rows)
    }

    pub async fn get_all_nodes(&self) -> Result<Vec<MemoryNode>> {
        let mut resp = self
            .db
            .query(format!("SELECT {} FROM node;", NODE_FIELDS))
            .await
            .context("get_all_nodes")?;
        let rows: Vec<MemoryNode> = resp.take(0)?;
        Ok(rows)
    }

    pub async fn get_all_edges(&self) -> Result<Vec<RelationalEdge>> {
        let mut resp = self
            .db
            .query(format!("SELECT {} FROM edge;", EDGE_FIELDS))
            .await
            .context("get_all_edges")?;
        let rows: Vec<RelationalEdge> = resp.take(0)?;
        Ok(rows)
    }

    pub async fn edges_for_nodes(
        &self,
        node_ids: &std::collections::HashSet<String>,
        owner: Option<&str>,
    ) -> Result<Vec<RelationalEdge>> {
        if node_ids.is_empty() {
            return Ok(vec![]);
        }
        let ids: Vec<String> = node_ids.iter().map(|i| strip_id_prefix(i)).collect();
        let owner = owner.map(normalize_owner);
        let sql = match owner {
            Some(_) => format!(
                "SELECT {} FROM edge WHERE (source IN $ids OR target IN $ids) AND owner_uri = $owner;",
                EDGE_FIELDS
            ),
            None => format!(
                "SELECT {} FROM edge WHERE source IN $ids OR target IN $ids;",
                EDGE_FIELDS
            ),
        };
        let mut query = self.db.query(&sql).bind(("ids", ids));
        if let Some(o) = owner {
            query = query.bind(("owner", o));
        }
        let mut resp = query.await.context("edges_for_nodes")?;
        let rows: Vec<RelationalEdge> = resp.take(0)?;
        Ok(rows)
    }

    pub async fn delete_node(&self, id: &str) -> Result<bool> {
        let key = canonical_node_id(id);
        let bare = strip_id_prefix(id);
        // Cascade first: an edge whose endpoint is gone is unreadable noise.
        let mut dangling = self
            .db
            .query(format!(
                "SELECT {} FROM edge WHERE source = $id OR target = $id;",
                EDGE_FIELDS
            ))
            .bind(("id", key.clone()))
            .await
            .context("find dangling edges")?;
        let edges: Vec<RelationalEdge> = dangling.take(0)?;
        for edge in edges {
            let _ = self.delete_edge(&edge.id).await;
        }

        let deleted: Option<MemoryNode> = self
            .db
            .delete(("node", bare.as_str()))
            .await
            .context("delete_node")?;
        Ok(deleted.is_some())
    }

    pub async fn delete_edge(&self, id: &str) -> Result<bool> {
        let bare = strip_id_prefix(id);
        let deleted: Option<RelationalEdge> = self
            .db
            .delete(("edge", bare.as_str()))
            .await
            .context("delete_edge")?;
        Ok(deleted.is_some())
    }

    /// Read-modify-write: `update(...).content(partial)` would replace the whole
    /// record and silently null out stability/impact.
    pub async fn set_node_locked(&self, id: &str, locked: bool) -> Result<Option<MemoryNode>> {
        match self.get_node(id).await? {
            Some(mut node) => {
                node.locked = locked;
                node.updated_at = chrono::Utc::now();
                self.upsert_node(&node).await?;
                Ok(Some(node))
            }
            None => Ok(None),
        }
    }

    pub async fn set_edge_locked(&self, id: &str, locked: bool) -> Result<Option<RelationalEdge>> {
        match self.get_edge(id).await? {
            Some(mut edge) => {
                edge.locked = locked;
                self.upsert_edge(&edge).await?;
                Ok(Some(edge))
            }
            None => Ok(None),
        }
    }

    pub async fn counts(&self) -> Result<(usize, usize)> {
        let nodes = self.get_all_nodes().await?.len();
        let edges = self.get_all_edges().await?.len();
        Ok((nodes, edges))
    }
}
