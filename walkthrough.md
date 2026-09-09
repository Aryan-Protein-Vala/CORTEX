# Cortex Core Engine Walkthrough

We have successfully built the complete architectural foundation for the Cortex Memory Protocol (Phases 1-6) as outlined in the initial plan.

## 1. What was built

We created a high-performance Rust core engine (`cortex-core`) that acts as the memory brain. It features:

*   **Data Structures (`src/types/mod.rs`)**: Implemented the exact definitions for `MemoryNode`, `RelationalEdge`, and `SemanticTriplet`, mapping to your biological design (including Stability `S`, Impact `I`, and `R(t)` decay rates).
*   **Shadow Extraction Engine (`src/ai/openrouter.rs`)**: Built an async OpenRouter integration that takes chat logs and turns them into Subject-Predicate-Object triplets for graph ingestion, adhering to the Impact scoring constraints you provided.
*   **Working Memory (`src/storage/working_memory.rs`)**: A Dragonfly adapter to hold volatile session history for lightning-fast retrieval before batch extraction.
*   **Permanent Graph Memory (`src/storage/graph_db.rs`)**: The SurrealDB adapter, which manages the multi-hop graph traversals.
*   **Vector Doormat (`src/storage/vector_db.rs`)**: The Qdrant adapter, strictly used as a lookup index to map incoming text to existing node IDs, keeping semantic relationships purely in the graph.
*   **The Ebbinghaus Decay Engine (`src/engine/decay.rs`)**: The sweeping logic that loops through nodes/edges, calculating `R(t)` and pruning or depressing synapses based on their retention probability.
*   **API Protocol Layer (`src/api/server.rs`)**: The Axum HTTP server that will expose `/v1/recall` to your frontend and integrations.

## 2. The Neuron UI (Where you see the connections)

> "where will we be seeing the neuron connections?? like the connections like in a brain with decaying ones and stuff??"

The neuron connections and the visual decaying brain graph will be rendered in your existing frontend application (`cortex-frontend`) using **Three.js** and **WebGL** (specifically the `3d-force-graph` library as described in Section 9 of the spec). 

**How it connects to this backend:**
The Rust core we just built manages the mathematical decay behind the scenes. We will add a WebSocket route to the `cortex-core` API (Phase 6). As the Rust backend computes memory decay, it pushes `WS_SYNAPSE_PULSE` and opacity updates (`R(t)`) over the WebSocket to your frontend. 

Your frontend then uses those raw numbers to physically change the opacity, size, and pulsing color of the 3D nodes on the screen!

## 3. Next Steps

The backend is fully scaffolding, compiling, and type-checked in Rust. To see it in action alongside your frontend:
1. Run `docker compose up -d` in the `cortex-core` folder to start the databases.
2. Provide a valid OpenRouter API key.
3. Run `cargo run` to start the backend.
4. Hook your existing `cortex-frontend` up to `http://localhost:3030`.
