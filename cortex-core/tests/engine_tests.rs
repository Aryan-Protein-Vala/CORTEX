use cortex_core::types::{MemoryNode, RelationalEdge, SemanticTriplet, CortexContextPacket};
use cortex_core::engine::decay::DecayEngine;
use cortex_core::engine::overwrite::StateOverwriteEngine;
use chrono::{Duration, Utc};
use std::collections::HashMap;

#[test]
fn test_memory_node_retention_and_access() {
    let mut node = MemoryNode::new("Rust");
    assert_eq!(node.label, "Rust");
    assert!((node.retention_probability() - 1.0).abs() < 0.01);

    // Test access count and stability reinforcement
    node.mark_accessed();
    assert_eq!(node.access_count, 1);
    assert!(node.stability > 1.0);

    // Test time elapsed decay
    node.last_accessed = Utc::now() - Duration::days(30);
    let decayed_r = node.retention_probability();
    assert!(decayed_r < 1.0);
    assert!(decayed_r >= 0.0);

    // Amygdala lock guarantees 100% retention
    node.locked = true;
    assert_eq!(node.retention_probability(), 1.0);
}

#[test]
fn test_decay_engine_sweep() {
    let decay = DecayEngine::new();
    let node1 = MemoryNode::new("Active Concept");
    let mut node2 = MemoryNode::new("Ancient Junk");
    node2.last_accessed = Utc::now() - Duration::days(365); // 1 year ago

    let mut nodes = vec![node1.clone(), node2.clone()];
    let pruned_node_ids = decay.process_nodes_sweep(&mut nodes);

    assert_eq!(pruned_node_ids.len(), 1);
    assert_eq!(pruned_node_ids[0], node2.id);

    // Test edge synaptic depression and pruning
    let edge = RelationalEdge::new(&node1.id, "related_to", &node2.id, 0.5);
    let mut edges = vec![edge.clone()];
    let mut retentions = HashMap::new();
    retentions.insert(node1.id.clone(), 0.95);
    retentions.insert(node2.id.clone(), 0.01); // severely decayed

    let pruned_edge_ids = decay.process_edges_sweep(&mut edges, &retentions);
    assert_eq!(pruned_edge_ids.len(), 1);
    assert_eq!(pruned_edge_ids[0], edge.id);
}

#[test]
fn test_overwrite_engine_conflict_resolution() {
    let overwrite = StateOverwriteEngine::new();
    let source_id = "node:user123";
    let target_id = "node:lang456";

    let edge = RelationalEdge::new(source_id, "prefers_python", target_id, 0.9);
    let mut edges = vec![edge.clone()];

    let contradiction_triplet = SemanticTriplet {
        subject: "User".to_string(),
        predicate: "prefers_rust".to_string(),
        object: "Programming Language".to_string(),
        confidence: 0.98,
        impact: 9,
        overwrite: true,
    };

    let result = overwrite.apply_overwrite(
        &contradiction_triplet,
        source_id,
        target_id,
        &mut edges
    ).expect("Overwrite apply failed");

    assert!(result.is_some());
    let new_edge = result.unwrap();
    assert_eq!(new_edge.predicate, "prefers_rust");
    assert!((new_edge.weight - 0.95).abs() < 0.01);

    // Old edge should now be historical with weight 0
    assert!(edges[0].is_historical);
    assert_eq!(edges[0].weight, 0.0);
}

#[test]
fn test_context_packet_serialization() {
    let node = MemoryNode::new("SurrealDB");
    let packet = CortexContextPacket {
        user_id: "test_user".to_string(),
        nodes: vec![node],
        edges: vec![],
        rules: vec![],
        token_estimate: 500,
        context: "SurrealDB memory graph context".to_string(),
    };

    let json = serde_json::to_string(&packet).expect("Failed to serialize");
    assert!(json.contains("SurrealDB"));
    assert!(json.contains("test_user"));
}

#[test]
fn test_global_mesh_node_deduplication() {
    let mut node1 = MemoryNode::new("React 19");
    node1.id = "node:react19".to_string();
    node1.owner_uri = "cortex://aryan".to_string();

    let mut node2_dup = MemoryNode::new("React 19");
    node2_dup.id = "node:react19".to_string();
    node2_dup.owner_uri = "cortex://global".to_string();

    let mut node3_global = MemoryNode::new("Server Actions");
    node3_global.id = "node:server_actions".to_string();
    node3_global.owner_uri = "cortex://global".to_string();

    let mut combined_nodes = vec![node1, node2_dup, node3_global];

    let mut seen_node_ids = std::collections::HashSet::new();
    combined_nodes.retain(|n| seen_node_ids.insert(n.id.clone()));

    assert_eq!(combined_nodes.len(), 2);
    assert_eq!(combined_nodes[0].id, "node:react19");
    assert_eq!(combined_nodes[1].id, "node:server_actions");
}
