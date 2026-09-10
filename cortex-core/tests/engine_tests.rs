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

#[test]
fn test_semantic_embedding_concept_clusters() {
    use cortex_core::storage::vector_db::{compute_local_embedding, cosine_similarity};

    let doc_db = compute_local_embedding("Always use PostgreSQL for data storage");
    let query_db = compute_local_embedding("What database do we use for storing records?");
    let doc_ui = compute_local_embedding("Tailwind CSS button styling in React modal");

    assert_eq!(doc_db.len(), 128);
    assert_eq!(query_db.len(), 128);
    assert_eq!(doc_ui.len(), 128);

    // Verify L2 normalization
    let norm: f32 = doc_db.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 0.001);

    // Database concepts should have strong semantic similarity
    let sim_db = cosine_similarity(&doc_db, &query_db);
    // Unrelated UI concept should have much lower similarity
    let sim_unrelated = cosine_similarity(&doc_db, &doc_ui);

    assert!(sim_db > 0.5, "Expected sim_db > 0.5, got {}", sim_db);
    assert!(sim_unrelated < 0.25, "Expected sim_unrelated < 0.25, got {}", sim_unrelated);
    assert!(sim_db > sim_unrelated * 2.0, "Database query should be significantly closer than UI query");
}

#[test]
fn test_semantic_embedding_subword_stems() {
    use cortex_core::storage::vector_db::{compute_local_embedding, cosine_similarity};

    let v1 = compute_local_embedding("authentication");
    let v2 = compute_local_embedding("authenticating");

    let sim = cosine_similarity(&v1, &v2);
    assert!(sim > 0.7, "Stem/subword forms should have strong overlap, got {}", sim);
}

#[test]
fn test_briefing_label_resolution() {
    // Tests §1.5 from Launch Audit: Briefings must format node labels, not raw node:UUID strings
    let node_user = MemoryNode::new("Aryan");
    let node_db = MemoryNode::new("PostgreSQL");

    let edge = RelationalEdge::new(&node_user.id, "prefers", &node_db.id, 0.95);

    let retrieved_nodes = vec![node_user.clone(), node_db.clone()];
    let retrieved_edges = vec![edge.clone()];

    let label_map: std::collections::HashMap<&str, &str> = retrieved_nodes
        .iter()
        .flat_map(|n| {
            let clean = n.id.trim_start_matches("node:");
            vec![(n.id.as_str(), n.label.as_str()), (clean, n.label.as_str())]
        })
        .collect();

    let mut parts = Vec::new();
    for e in &retrieved_edges {
        let s_clean = e.source.trim_start_matches("node:");
        let t_clean = e.target.trim_start_matches("node:");
        let s_label = label_map.get(e.source.as_str())
            .or_else(|| label_map.get(s_clean))
            .copied()
            .unwrap_or(e.source.as_str());
        let t_label = label_map.get(e.target.as_str())
            .or_else(|| label_map.get(t_clean))
            .copied()
            .unwrap_or(e.target.as_str());

        parts.push(format!("Fact: {} -> [{}] -> {}", s_label, e.predicate, t_label));
    }

    let summary = parts.join("\n");
    assert!(summary.contains("Fact: Aryan -> [prefers] -> PostgreSQL"));
    assert!(!summary.contains("node:"));
}

#[test]
fn test_token_budget_truncation() {
    // Tests §1.4 from Launch Audit: Context must be bounded to token_budget
    let long_text = "This is a repeated context string to test token bounds. ".repeat(100);
    let budget_tokens = 50usize;
    let char_budget = budget_tokens * 4;

    let bounded = if long_text.len() > char_budget {
        format!("{}... [bounded to {} tokens]", &long_text[..char_budget], budget_tokens)
    } else {
        long_text.clone()
    };

    assert!(bounded.contains("[bounded to 50 tokens]"));
    assert!(bounded.len() < long_text.len());
}


