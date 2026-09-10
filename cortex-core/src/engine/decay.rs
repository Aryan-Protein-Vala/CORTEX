use crate::types::{MemoryNode, RelationalEdge};

/// Process the Ebbinghaus decay sweep across all nodes and edges.
/// In production, this would be invoked by a Cron job or a daily worker.
pub struct DecayEngine;

impl DecayEngine {
    pub fn new() -> Self {
        Self
    }
    
    /// Processes a batch of nodes, returning the subset that have decayed below the pruning threshold.
    pub fn process_nodes_sweep(&self, nodes: &mut [MemoryNode]) -> Vec<String> {
        let mut to_prune = Vec::new();
        
        for node in nodes.iter_mut() {
            let retention = node.retention_probability();
            
            // Hard delete threshold
            if retention < 0.05 {
                to_prune.push(node.id.clone());
            }
        }
        
        to_prune
    }
    
    /// Processes a batch of edges, applying synaptic depression.
    pub fn process_edges_sweep(&self, edges: &mut [RelationalEdge], node_retentions: &std::collections::HashMap<String, f32>) -> Vec<String> {
        let mut to_prune = Vec::new();
        
        for edge in edges.iter_mut() {
            // If the source or target node retention is extremely low or missing, prune the edge
            let source_r = node_retentions.get(&edge.source).unwrap_or(&0.0);
            let target_r = node_retentions.get(&edge.target).unwrap_or(&0.0);
            
            if *source_r < 0.05 || *target_r < 0.05 {
                to_prune.push(edge.id.clone());
                continue;
            }
            
            // Synaptic depression: Pathways that decay lose 10% of weight per sweep
            if *source_r < 0.15 || *target_r < 0.15 {
                edge.apply_depression(0.10);
                
                if edge.weight < 0.01 {
                    to_prune.push(edge.id.clone());
                }
            }
        }
        
        to_prune
    }
}
