use anyhow::{Result, Context};
use surrealdb::engine::any::connect;
use surrealdb::engine::any::Any;
use surrealdb::Surreal;
use crate::types::{MemoryNode, RelationalEdge};

pub struct GraphMemory {
    db: Surreal<Any>,
}

impl GraphMemory {
    pub async fn new(url: &str, user: &str, pass: &str, namespace: &str, database: &str) -> Result<Self> {
        let db = connect(url).await.context("Failed to connect to SurrealDB")?;
        
        db.signin(surrealdb::opt::auth::Root {
            username: user,
            password: pass,
        }).await.context("Failed to sign in to SurrealDB")?;
        
        db.use_ns(namespace).use_db(database).await.context("Failed to select namespace/database")?;
        
        Ok(Self { db })
    }
    
    /// Upsert a node into the graph
    pub async fn upsert_node(&self, node: &MemoryNode) -> Result<Option<MemoryNode>> {
        let clean_id = node.id.trim_start_matches("node:");
        let created: Option<MemoryNode> = self.db
            .update(("node", clean_id))
            .content(node)
            .await?;
        Ok(created)
    }
    
    /// Get a node by ID
    pub async fn get_node(&self, id: &str) -> Result<Option<MemoryNode>> {
        let clean_id = id.trim_start_matches("node:");
        let node: Option<MemoryNode> = self.db.select(("node", clean_id)).await?;
        Ok(node)
    }
    
    /// Upsert an edge between two nodes
    pub async fn upsert_edge(&self, edge: &RelationalEdge) -> Result<Option<RelationalEdge>> {
        let clean_id = edge.id.trim_start_matches("edge:");
        let created: Option<RelationalEdge> = self.db
            .update(("edge", clean_id))
            .content(edge)
            .await?;
        Ok(created)
    }
    
    /// Find a node by exact or canonical label
    pub async fn find_node_by_label(&self, label: &str) -> Result<Option<MemoryNode>> {
        let mut response = self.db
            .query("SELECT * FROM node WHERE label = $label LIMIT 1")
            .bind(("label", label.to_string()))
            .await?;
        let node: Option<MemoryNode> = response.take(0)?;
        Ok(node)
    }

    /// Retrieve all nodes in the knowledge graph
    pub async fn get_all_nodes(&self) -> Result<Vec<MemoryNode>> {
        let nodes: Vec<MemoryNode> = self.db.select("node").await?;
        Ok(nodes)
    }

    /// Retrieve all edges in the knowledge graph
    pub async fn get_all_edges(&self) -> Result<Vec<RelationalEdge>> {
        let edges: Vec<RelationalEdge> = self.db.select("edge").await?;
        Ok(edges)
    }

    /// Retrieve all nodes for a specific owner URI (cortex:// protocol)
    pub async fn get_nodes_by_owner(&self, owner_uri: &str) -> Result<Vec<MemoryNode>> {
        let clean = owner_uri.trim_start_matches("cortex://").to_string();
        let full = if owner_uri.starts_with("cortex://") { owner_uri.to_string() } else { format!("cortex://{}", owner_uri) };
        let default_alias = if clean == "default" || clean == "default_user" { "default_user".to_string() } else { clean.clone() };
        let default_cortex = if clean == "default" || clean == "default_user" { "cortex://default".to_string() } else { full.clone() };

        let mut response = self.db.query("SELECT * FROM node WHERE owner_uri = $owner OR owner_uri = $clean OR owner_uri = $full OR owner_uri = $alias OR owner_uri = $dcortex")
            .bind(("owner", owner_uri.to_string()))
            .bind(("clean", clean))
            .bind(("full", full))
            .bind(("alias", default_alias))
            .bind(("dcortex", default_cortex))
            .await?;
        let nodes: Vec<MemoryNode> = response.take(0)?;
        Ok(nodes)
    }

    /// Retrieve all edges for a specific owner URI (cortex:// protocol)
    pub async fn get_edges_by_owner(&self, owner_uri: &str) -> Result<Vec<RelationalEdge>> {
        let clean = owner_uri.trim_start_matches("cortex://").to_string();
        let full = if owner_uri.starts_with("cortex://") { owner_uri.to_string() } else { format!("cortex://{}", owner_uri) };
        let default_alias = if clean == "default" || clean == "default_user" { "default_user".to_string() } else { clean.clone() };
        let default_cortex = if clean == "default" || clean == "default_user" { "cortex://default".to_string() } else { full.clone() };

        let mut response = self.db.query("SELECT * FROM edge WHERE owner_uri = $owner OR owner_uri = $clean OR owner_uri = $full OR owner_uri = $alias OR owner_uri = $dcortex")
            .bind(("owner", owner_uri.to_string()))
            .bind(("clean", clean))
            .bind(("full", full))
            .bind(("alias", default_alias))
            .bind(("dcortex", default_cortex))
            .await?;
        let edges: Vec<RelationalEdge> = response.take(0)?;
        Ok(edges)
    }

    /// Publish nodes and edges to the Global Mesh (cortex://global)
    pub async fn publish_to_mesh(&self, nodes: Vec<MemoryNode>, edges: Vec<RelationalEdge>) -> Result<()> {
        for mut node in nodes {
            node.owner_uri = "cortex://global".to_string();
            // Optional: anonymize or strip PII from node.label or metadata here
            let _ = self.upsert_node(&node).await;
        }
        for mut edge in edges {
            edge.owner_uri = "cortex://global".to_string();
            let _ = self.upsert_edge(&edge).await;
        }
        Ok(())
    }

    /// Delete a node by ID
    pub async fn delete_node(&self, id: &str) -> Result<()> {
        let clean_id = id.trim_start_matches("node:");
        let _: Option<MemoryNode> = self.db.delete(("node", clean_id)).await?;
        Ok(())
    }

    /// Delete an edge by ID
    pub async fn delete_edge(&self, id: &str) -> Result<()> {
        let clean_id = id.trim_start_matches("edge:");
        let _: Option<RelationalEdge> = self.db.delete(("edge", clean_id)).await?;
        Ok(())
    }
    
    /// Perform a parameterized multi-hop traversal to retrieve context safely
    pub async fn traverse(&self, start_node_id: &str, max_hops: u8) -> Result<(Vec<MemoryNode>, Vec<RelationalEdge>)> {
        use std::collections::{HashSet, VecDeque};

        let mut nodes: Vec<MemoryNode> = Vec::new();
        let mut edges: Vec<RelationalEdge> = Vec::new();
        let mut visited_nodes: HashSet<String> = HashSet::new();
        let mut visited_edges: HashSet<String> = HashSet::new();

        let initial_clean_id = start_node_id.trim_start_matches("node:").to_string();
        
        let start_node = match self.get_node(&initial_clean_id).await? {
            Some(n) => n,
            None => return Ok((nodes, edges)),
        };

        visited_nodes.insert(initial_clean_id.clone());
        nodes.push(start_node);

        let mut queue: VecDeque<(String, u8)> = VecDeque::new();
        queue.push_back((initial_clean_id, 0));

        let hop_limit = max_hops.clamp(1, 6);

        while let Some((curr_id, current_hop)) = queue.pop_front() {
            if current_hop >= hop_limit {
                continue;
            }

            let curr_id_clean = curr_id.trim_start_matches("node:").to_string();
            let curr_id_full = format!("node:{}", curr_id_clean);

            // Fetch outgoing and incoming edges matching either clean UUID or node:UUID
            let mut response = self.db
                .query("SELECT * FROM edge WHERE source = $s1 OR source = $s2 OR target = $s1 OR target = $s2")
                .bind(("s1", curr_id_full.clone()))
                .bind(("s2", curr_id_clean.clone()))
                .await?;

            let found_edges: Vec<RelationalEdge> = response.take(0)?;
            for edge in found_edges {
                if !visited_edges.contains(&edge.id) {
                    visited_edges.insert(edge.id.clone());
                    edges.push(edge.clone());
                }

                let neighbor_clean = if edge.source.contains(&curr_id_clean) {
                    edge.target.trim_start_matches("node:").to_string()
                } else {
                    edge.source.trim_start_matches("node:").to_string()
                };

                if !visited_nodes.contains(&neighbor_clean) {
                    visited_nodes.insert(neighbor_clean.clone());
                    if let Ok(Some(neighbor)) = self.get_node(&neighbor_clean).await {
                        nodes.push(neighbor);
                        if current_hop + 1 < hop_limit {
                            queue.push_back((neighbor_clean, current_hop + 1));
                        }
                    }
                }
            }
        }
        
        Ok((nodes, edges))
    }
    
    /// Execute the sweep (decay pruning) against live graph database
    pub async fn sweep_decay(&self, decay_engine: &crate::engine::decay::DecayEngine) -> Result<usize> {
        let mut nodes = self.get_all_nodes().await?;
        let node_ids_to_prune = decay_engine.process_nodes_sweep(&mut nodes);
        
        let mut node_retentions = std::collections::HashMap::new();
        for node in &nodes {
            node_retentions.insert(node.id.clone(), node.retention_probability());
        }
        
        let mut edges = self.get_all_edges().await?;
        let edge_ids_to_prune = decay_engine.process_edges_sweep(&mut edges, &node_retentions);
        
        let mut pruned_count = 0;
        for nid in &node_ids_to_prune {
            if self.delete_node(nid).await.is_ok() {
                pruned_count += 1;
            }
        }
        for eid in &edge_ids_to_prune {
            if self.delete_edge(eid).await.is_ok() {
                pruned_count += 1;
            }
        }
        
        Ok(pruned_count)
    }
}
