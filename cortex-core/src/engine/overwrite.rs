use crate::types::{RelationalEdge, SemanticTriplet};
use anyhow::Result;

/// The State Overwrite Protocol handles contradiction memory.
pub struct StateOverwriteEngine;

impl StateOverwriteEngine {
    pub fn new() -> Self {
        Self
    }
    
    /// Resolves conflicts when new triplet extraction contradicts an existing edge.
    /// E.g. User used to "like" Momos, now "dislikes" Momos.
    /// Instead of creating a duplicate node for Momos, we:
    /// 1. Flag the old edge as historical and set weight to 0
    /// 2. Create the new edge
    pub fn apply_overwrite(
        &self,
        new_triplet: &SemanticTriplet,
        source_id: &str,
        target_id: &str,
        existing_edges: &mut [RelationalEdge]
    ) -> Result<Option<RelationalEdge>> {
        
        if !new_triplet.overwrite {
            return Ok(None);
        }
        
        // Find existing edge with matching endpoints, but different predicate
        for edge in existing_edges.iter_mut() {
            let matches_source = edge.source == source_id || edge.source.eq_ignore_ascii_case(&new_triplet.subject);
            let matches_target = edge.target == target_id || edge.target.eq_ignore_ascii_case(&new_triplet.object);
            
            if matches_source && matches_target {
                if !edge.predicate.eq_ignore_ascii_case(&new_triplet.predicate) {
                    // Contradiction found. Obsolete the old edge.
                    edge.is_historical = true;
                    edge.weight = 0.0;
                    
                    // Create new edge anchored to the same original concept nodes
                    let new_edge = RelationalEdge::new(
                        &edge.source,
                        &new_triplet.predicate,
                        &edge.target,
                        0.95 // High initial weight for a direct correction
                    );
                    
                    return Ok(Some(new_edge));
                }
            }
        }
        
        Ok(None)
    }
}
