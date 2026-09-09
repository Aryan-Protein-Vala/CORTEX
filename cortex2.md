via glm 2 :

Here it is. The complete, final, god-beast document. Every decision we made across this entire conversation, consolidated into one definitive spec. Save this as `cortex.md` in your repo root. It serves three purposes: your personal bible, the handoff doc for any AI IDE, and the single source of truth for anyone who joins later.

---

```markdown
# CORTEX
## The Universal Memory Protocol for AI

> **One Memory. Every AI.**

---

## 0. WHAT CORTEX IS (READ THIS FIRST)

Cortex is a **model-agnostic, universal memory infrastructure** that gives every AI — ChatGPT, Claude, Gemini, DeepSeek, local open-source models — a single, permanent, human-like memory system.

**The core thesis:** LLMs currently have amnesia. Every conversation starts from zero, and "memory" today means brute-forcing raw chat history into an expensive, finite context window. This burns VRAM (the KV Cache crisis), degrades accuracy ("lost in the middle"), and locks users into single-vendor ecosystems.

**Cortex decouples Memory from Cognition.** The LLM is the thinker. Cortex is the brain's storage tissue. Memory lives in a language-agnostic semantic graph mesh that any AI can read, write, and traverse — via an open protocol (JSON-LD over MCP), a high-performance Rust engine, and a biological forgetting algorithm that keeps the graph lean, relevant, and alive for decades.

**What this enables:**
- Infinite, permanent, cross-model, cross-device memory for every user.
- 70–90% reduction in context token spend (flat O(1) cost regardless of history length).
- Massive KV Cache / VRAM offloading for AI providers.
- A universal language through which AI agents share state and talk to each other.
- A user-owned "digital soul" that outlives any single AI company.

**Cortex is not an app. It is not a wrapper. It is infrastructure — the HTTP of AI memory.**

---

## 1. CORE PRINCIPLES (NON-NEGOTIABLE)

1. **Memory is decoupled from models.** Swap GPT for Claude tomorrow; your memory graph is untouched. Node IDs are deterministic hashes, not vendor embeddings.
2. **The graph is the truth; vectors are only the doormat.** Storage and reasoning happen on graph topology (Subject → Predicate → Object). Vector search is used *exclusively* to map incoming raw text to existing Node IDs. Never for storage. Never for retrieval logic.
3. **Forgetting is a feature.** A brain that remembers everything is broken. Impact-weighted Ebbinghaus decay prunes noise, preserves what matters, and keeps query performance flat for life.
4. **The LLM never sees raw data.** A Context Assembler compresses retrieved sub-graphs into dense, pre-optimized JSON-LD briefings before any model is invoked. One context. Never two.
5. **Language-agnostic core.** "Dog," "perro," "chien" — one node. Human language is metadata; the concept is the entity.
6. **Open protocol, closed performance.** The schema (JSON-LD vocabulary), local SDK, and sync protocol are open-source. The deep multi-hop engine, cloud mesh, and advanced Amygdala weighting are proprietary.

---

## 2. THE 3-LAYER ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — WORKING MEMORY (Dragonfly / in-memory)               │
│  Volatile sliding-window buffer. Last 10 messages max.          │
│  <0.5ms latency. Wiped on session terminate.                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ async batch extraction on session end
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 — PERMANENT MEMORY MESH (SurrealDB graph)              │
│  Language-agnostic entity triplets. Stability/Impact metadata.  │
│  Multi-hop pathfinding. The user's permanent digital soul.      │
└──────────────────────────▲──────────────────────────────────────┘
                           │ read/write via Rust Core Engine
┌──────────────────────────┴──────────────────────────────────────┐
│  LAYER 3 — INTEGRATION FRAMEWORK                                 │
│  Primary: MCP Server (official, un-bannable, IDE-native)        │
│  Secondary: Browser Extension (network interception)             │
│  Tertiary: npm SDK + CLI + gRPC/REST Cloud API                   │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1 — Working Memory (The Hippocampus)
- **Tech:** Dragonfly (multi-threaded Redis-compatible, C++).
- **Behavior:** Holds raw transcript of the last 5–10 turns of the active `chat_id`. Strict token ceiling (≤2,048 tokens). Resolves indexicals ("it," "this," "that bug") before parsing.
- **Purge:** On session close or >15 min idle, the buffer is dumped to the Shadow Extraction queue and wiped. Nothing persists here.

### Layer 2 — Permanent Memory Mesh (The Neocortex)
- **Tech:** SurrealDB (Rust-native multi-model graph).
- **Behavior:** One global graph per `user_id`, shared across every chat, tool, and model. Nodes are concepts; edges are typed, weighted relationships.
- **Traversal:** BFS/Dijkstra at the database level. Free tier: 2 hops. Pro: 6+ hops. Pathfinding runs code-side — the LLM never performs graph reasoning on the whole mesh.

### Layer 3 — Integration Framework (The Nervous System)
Every surface Cortex ships on (detailed in §7): MCP server, browser extension, npm SDK, CLI, cloud API. All surfaces speak the same protocol to the same Rust core.

---

## 3. THE MEMORY ALGORITHMS (THE SOUL OF CORTEX)

### 3.1 Impact-Weighted Ebbinghaus Decay

Every node and edge carries **Stability (S)** and **Impact (I)**. Retention over time:

```
R(t) = e^( -t / (S · I) )
```

- `t` — seconds since last access/reinforcement
- `S` — Stability, 1.0 ≤ S ≤ 100.0. Reinforcement grows it logarithmically: `S_new = S_old + ln(1 + hits)`
- `I` — Impact Factor, 1–10. Assigned by the Shadow Extraction kernel (emotional weight, future plans, core identity, corrections = high I).

**Why I exists:** A startup idea left untouched for 4 years with I=10 retains R ≈ 0.95. Lunch preferences with I=1 decay to nothing in weeks. The curve flattens for what matters — exactly like a human brain.

### 3.2 Algorithmic Neuroplasticity (Edge Weights)

Every edge carries a synaptic weight `W` (0.0–1.0).

- **Long-Term Potentiation (LTP):** Every time a pathway is traversed during recall, `W → 1.0`. Frequently used knowledge becomes structurally dominant.
- **Synaptic Depression:** Pathways that decay (0.05 < R < 0.15) lose 10% of W per sweep cycle.

### 3.3 State Overwrite Protocol (Contradictions)

When new extraction directly contradicts an existing edge (user *liked* momos, now *hates* momos), Cortex does NOT create a duplicate competing record:

1. The obsolete edge's `predicate` is updated (`likes` → `dislikes`).
2. The old directional pathway weight is zeroed.
3. The new edge is anchored to the **original concept node** at high weight.

The graph never bloats. The AI adapts to who you are *now* without amnesia about who you were.

### 3.4 The Amygdala Engine (Procedural Rules)

User corrections ("No," "Wrong," "Stop," "Actually, I use Postgres") trigger the friction detector:

1. Capture the AI's failed output + the user's correction.
2. Generate a **Procedural Rule**: `TRIGGER_CONTEXT` + `ABSOLUTE_DIRECTIVE` (e.g., "When writing JS → NEVER use `var`. ALWAYS `let`/`const`.").
3. Rules are stored in a **separate, non-decaying bank** and injected into every future system prompt for that user. The AI is structurally incapable of repeating the mistake.

### 3.5 Reconsolidation & Re-Learning

- **Contradiction memory:** Superseded facts are retained as low-weight historical edges — the AI knows both states of time ("You used MySQL, but migrated to Postgres").
- **Re-learning boost:** If a fully decayed memory is re-introduced by the user, the new node is created with elevated base Stability (`S₀ = 2 × default`). Second learning decays twice as slow. Biology, replicated.

### 3.6 The Sweep Engine (Cron)

A Rust background worker (daily in production, configurable):
1. Compute `R(t)` for all nodes and edges.
2. `R < 0.05` → **Synaptic Pruning**: hard-delete node + attached edges (respecting Amygdala locks).
3. `0.05 ≤ R < 0.15` → depress connected edge weights by 10%.
4. Database size follows a **logistic growth curve** — rapid early growth, then plateau as decay rate equals ingestion rate. A stable, adult brain.

---

## 4. DATA SCHEMAS (THE UNIVERSAL LANGUAGE)

### 4.1 Rust Core Structs

```rust
use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MemoryNode {
    pub id: String,                // Deterministic hash: "node:9a32f1"
    pub label: String,             // Canonical label: "Python"
    pub aliases: Vec<String>,      // ["py", "python3", "pitón"]
    pub stability: f32,            // S — reinforcement depth (1.0–100.0)
    pub impact: u8,                // I — decay dampener (1–10)
    pub locked: bool,              // Amygdala lock (never decays)
    pub updated_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RelationalEdge {
    pub id: String,
    pub source: String,            // Subject node ID
    pub target: String,            // Object node ID
    pub predicate: String,         // "proficient_in", "dislikes", "founded"
    pub weight: f32,               // W — synaptic strength (0.0–1.0)
    pub is_historical: bool,       // Superseded but remembered
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProceduralRule {
    pub rule_id: String,
    pub trigger_context: String,   // "When writing JavaScript"
    pub absolute_directive: String,// "NEVER use var. ALWAYS use const."
    pub created_at: i64,
    pub origin: String,            // The correction that spawned it
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CortexContextPacket {
    pub user_id: String,
    pub nodes: Vec<MemoryNode>,
    pub edges: Vec<RelationalEdge>,
    pub rules: Vec<ProceduralRule>,
    pub token_estimate: u32,       // Hard cap enforced before injection
}
```

### 4.2 Universal JSON-LD Packet (Inter-Agent Exchange Format)

```json
{
  "@context": {
    "ucw": "https://cortex.dev/vocab",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "xsd": "http://www.w3.org/2001/XMLSchema#"
  },
  "@graph": [
    {
      "@id": "ucw:node_9a32",
      "@type": "ucw:Concept",
      "ucw:label": "Project Alpha",
      "ucw:stability": 45.2,
      "ucw:impact": 10,
      "ucw:lastAccessed": "2026-08-21T15:00:00Z"
    },
    {
      "@id": "ucw:edge_114b",
      "@type": "rdf:Statement",
      "rdf:subject": { "@id": "ucw:user_root" },
      "rdf:predicate": { "@id": "ucw:rel_founded" },
      "rdf:object": { "@id": "ucw:node_9a32" },
      "ucw:weight": 0.98
    }
  ]
}
```

Every LLM on earth has ingested JSON-LD/RDF in training. GPT, Claude, Gemini, and 8B local models all parse this natively, instantly, with zero fine-tuning. This is the Esperanto of agents.

### 4.3 gRPC Service Definition (Wire Protocol)

```protobuf
syntax = "proto3";
package cortex.v1;

service CortexEngine {
  // Real-time: retrieve compressed context for a prompt
  rpc GetContext (ContextRequest) returns (ContextPacket);
  // Batch: push terminated session logs for extraction
  rpc IngestSession (SessionLog) returns (IngestAck);
  // Real-time: reinforce a pathway that was just used
  rpc Reinforce (NodeHit) returns (ReinforceAck);
  // Multi-device sync (local-first deltas)
  rpc SyncPush (SyncDelta) returns (SyncPull);
  // Management
  rpc LockNode (LockRequest) returns (LockAck);      // Amygdala lock
  rpc Forget (ForgetRequest) returns (ForgetAck);    // Manual delete
  rpc GraphStats (StatsRequest) returns (StatsReply); // Node/edge counts
}

message ContextRequest {
  string user_id = 1;
  string prompt_text = 2;
  uint32 max_hops = 3;        // 2 free, 6+ pro
  uint32 token_budget = 4;    // default 500
}
```

### 4.4 Deterministic Node IDs

Node IDs are content-hashed from the canonical concept (e.g., `sha256("python") → node:9a32f1`). This guarantees:
- No duplicate nodes across languages or sessions.
- Two devices discussing the same concept converge on the same ID without coordination.
- Model-agnostic permanence — the ID survives every vendor.

---

## 5. THE LIVE PIPELINE (HOW ONE MESSAGE FLOWS)

```
[User types prompt in Chat UI / IDE]
        │
        ▼
① INTERCEPT — Extension hooks DOM/network boundary (or MCP tool fires).
        │  Raw text → local Rust core via WebSocket/native messaging.
        ▼
② MAP — Qdrant index maps prompt terms → existing Node IDs. (vectors = doormat only)
        │
        ▼
③ TRAVERSE — SurrealDB BFS/Dijkstra, max-hop sub-mesh retrieval.
        │  Every hit reinforces the pathway (LTP) + resets decay clock.
        ▼
④ ASSEMBLE — Context Assembler compresses sub-mesh + Amygdala rules
        │  into ONE JSON-LD briefing. token_estimate enforced (≤500 default).
        │  Weakest edges pruned first if over budget.
        ▼
⑤ INJECT — Briefing appended to payload as structured context block.
        │  Payload released to target LLM. Total added latency: <5ms.
        ▼
⑥ RESPOND — LLM answers with full knowledge of the user's history.
        │
        ▼
⑦ SHADOW EXTRACT (async, tokio::spawn) — On session terminate:
        · Session log → batch call to cheap model (Llama-3-8B class,
          ~$0.07/1M tokens) → Subject-Predicate-Object triplets
          + Impact scores.
        · Triplets upserted into graph via State Overwrite Protocol.
        · Working Memory wiped. Done.
```

**Cost invariant:** The LLM reads `system prompt + ≤500-token briefing + live window`. Whether the user has 3 days or 3 years of history, per-message token cost is **flat**. Traditional systems scale linearly to exponentially. Cortex is O(1) to O(log N). This is the mathematical moat.

---

## 6. THE SHADOW AI EXTRACTION KERNEL

**Never runs continuously.** Fires once per terminated session (batch = cheap). 

**System prompt spec:**

```text
Identity: You are a strict semantic extraction kernel.
Task: Analyze the conversation log. Output entities, concepts, and
their explicit inter-relations.

Constraints:
1. Output MUST be a valid JSON array of relationship objects.
2. Do NOT summarize. Decompose into Subject -> Predicate -> Object triplets.
3. Assign Impact Factor (1–10): emotional depth, future plans, core
   identity, and corrections score 8–10. Trivia scores 1–3.
4. Normalize predicates to snake_case verbs ("proficient_in", "founded",
   "dislikes").
5. If a triplet CONTRADICTS a supplied existing-fact list, emit it with
   flag "overwrite": true.
```

**Impact scoring matrix:**
| Signal | Impact |
|---|---|
| Core identity, names, relationships | 9–10 |
| Active projects, startup ideas, goals | 8–10 |
| Strong preferences & corrections ("never/always") | 7–9 |
| Skills, tools, stacks | 5–7 |
| Ongoing tasks | 3–5 |
| Small talk, one-off trivia | 1–2 |

---

## 7. DISTRIBUTION SURFACES (EVERY WAY CORTEX SHIPS)

### 7.1 MCP Server (Primary Channel)
Official Model Context Protocol server. Works natively with Claude Desktop, Cursor, Windsurf, VS Code agents, and every MCP-compatible tool. Zero ban risk, zero scraping.
- Tools exposed: `cortex_remember`, `cortex_recall`, `cortex_forget`, `cortex_lock`, `cortex_stats`.
- Config: `"mcpServers": { "cortex": { "command": "npx", "args": ["-y", "@cortex/mcp"] } }`

### 7.2 npm SDK (Developer Channel)
```js
import { Cortex } from '@cortex/sdk';

const cortex = new Cortex({ mode: 'local' });        // embedded SurrealDB
await cortex.ingest(sessionLog);                      // batch extract → graph
const briefing = await cortex.recall(userPrompt, { hops: 3, tokenBudget: 500 });
// briefing = compressed JSON-LD context, ready to prepend to any LLM call
```
Framework adapters: `@cortex/langchain`, `@cortex/llamaindex`, `@cortex/vercel-ai`.

### 7.3 Browser Extension (Consumer Trojan Horse)
- Manifest V3. TypeScript.
- Intercepts outbound chat payloads on ChatGPT/Claude/Gemini web via network hooks; pauses ~15–30ms; queries the local Rust core over WebSocket; appends the context frame; releases.
- Ships with the **Retroactive Hydrator** (§10) for day-one value.
- Genuinely free. This is the viral adoption engine.

### 7.4 CLI
```bash
cortex init                      # boot local engine + graph
cortex recall "react bug"        # print retrieved sub-mesh as JSON-LD
cortex ingest ./session.json     # batch extract a log
cortex forget --older-than 30d   # manual prune
cortex lock <node_id>            # Amygdala lock
cortex stats                     # nodes, edges, decay health
cortex sync                      # push/pull cloud deltas
cortex ui                        # launch the Neuron UI locally
```

### 7.5 Cloud API (gRPC + REST gateway)
Hosted mesh for multi-device and B2B. Same proto as §4.3.

---

## 8. MULTI-DEVICE SYNC PROTOCOL (LOCAL-FIRST)

1. **Local transaction log:** Every mutation appends to an embedded append-only ledger (RocksDB) with vector-clock state. Users are never blocked on the network.
2. **CRDTs for convergence:**
   - Stability/decay deltas → G-counters (phone -0.05, laptop -0.05 → merged -0.10, no conflict).
   - Edges → add-only sets. Divergent additions both survive.
   - Deletions → tombstones (hidden locally, purged globally only when all replicas + cloud agree).
3. **Sync cycle:** On session end or interval, the ledger bundle compresses into a gRPC `SyncDelta` push. Cloud resolves CRDTs, runs deep consolidation, and returns `SyncPull` (cross-device updates + server-discovered edges + purge commands).
4. **The moat:** The local SDK is intentionally "dumb" (CRUD + 2-hop traversal). Deep multi-hop intelligence, cross-device consolidation, and advanced weighting run **only** server-side during sync. Open-source core, proprietary brain.

---

## 9. THE NEURON UI (THE VIRAL CANVAS)

A live, explorable 3D rendering of the user's actual memory graph.

- **Engine:** WebGL via `3d-force-graph` (Three.js). D3-force simulation: nodes repel electrostatically, edges pull like springs. Rendering offloaded to client GPU — thousands of nodes at 60fps.
- **Theme:** Same industrial aesthetic as the site. Titanium/silver lines on charcoal; muted grey on white. No neon.
- **Live bindings:**
  - Node opacity + scale ← real-time `R(t)`. Memories literally fade as they decay, flash back to full brightness on reinforcement.
  - `WS_SYNAPSE_PULSE` WebSocket events fire traveling light waves along edges during live recall. Users *watch the AI think*.
  - `WS_NODE_HIT` events pulse nodes on access.
- **Manual rewiring:** Click a node, drag a connector to another node, drop → instant graph mutation written to the engine. Users can also lock nodes (Amygdala), merge duplicates, and sever stale edges by hand.
- **Why it matters:** Users will screen-record their fading, pulsing, growing brain-mesh and post it. It is the marketing engine, the debugging tool, and the trust surface (full data ownership, visible and editable) in one.

---

## 10. THE RETROACTIVE HYDRATOR (DAY-ONE VALUE)

Cold start is death for memory products. Cortex solves it at install:

1. User supplies official data exports (ChatGPT `conversations.json`, Claude exports) or authorizes local session parsing.
2. Rust runtime slices history into chunks → batch Shadow Extraction queue.
3. Thousands of triplets extracted and upserted in ~10 minutes, with `last_accessed` backdated so old history decays naturally while recent history stays bright.
4. First live prompt already has months of memory behind it. The "dayumm" moment happens in minute eleven.

---

## 11. TECH STACK (DEFINITIVE)

| Layer | Technology | Why |
|---|---|---|
| Core engine | **Rust + Tokio** | Zero-GC, memory-safe, microsecond hot paths |
| Working memory | **Dragonfly** | Multi-threaded in-memory cache, millions of ops/sec |
| Permanent mesh | **SurrealDB** | Rust-native multi-model graph, horizontal scaling |
| Node mapping | **Qdrant** | Fast text→Node-ID resolution only. Never storage. |
| Wire protocol | **gRPC (Protobuf) / HTTP2** | Dense binary transport, sub-ms serialization |
| Data format | **JSON-LD (RDF triplets)** | Universal, model-agnostic, natively understood by all LLMs |
| Integration | **MCP** | Official, un-bannable, IDE-native channel |
| Extension | **TypeScript, Manifest V3** | DOM/network interception on AI web UIs |
| Shadow AI | **Llama-3-8B class** (~$0.07/1M tok) | Batch-only extraction, negligible cost |
| UI canvas | **Three.js / 3d-force-graph + WebGL** | GPU-rendered live neural mesh |
| Sync | **CRDTs + append-only ledger (RocksDB)** | Local-first, conflict-free multi-device |

---

## 12. MONETIZATION

| Tier | Price | Limits | Purpose |
|---|---|---|---|
| **Free** | $0/mo | 5,000 nodes · local-only · 2-hop traversal · standard decay | Viral adoption. Break platform lock-in. |
| **Pro Synapse** | $9/mo | Unlimited nodes · encrypted multi-device cloud sync · Amygdala locks · 6+ hop traversal | Power users, developers. |
| **Enterprise** | Custom | On-prem · SLA · value-based licensing on GPU/KV-Cache savings | LLM providers & platforms. |

**The enterprise pitch:** "Your agents burn VRAM re-reading context. Route memory through Cortex: context windows stay tiny, KV Cache overhead drops up to 90%, your GPU bill drops with it. We charge a fraction of what we save you."

**License:** Open-core. Protocol, schema, and local SDK = AGPLv3 (forces Big Tech to the table). Cloud, deep-hop engine, and advanced Amygdala = proprietary commercial.

---

## 13. THE CORTEX ECOSYSTEM (THE COMPLETE SYSTEM)

The core protocol is the foundation. Built on it, as one continuous system:

1. **Cortex Core** — The Rust engine, mesh, SDKs, extension, CLI, MCP server, Neuron UI. (Everything in this document.)
2. **Cortex Cloud** — Graph-as-a-Service. `cortex.remember()` / `cortex.recall()` as a hosted API for agent builders. Multi-region, metered, zero-infrastructure for devs.
3. **Cortex Agent Browser** — A pixel-free execution environment where AI agents browse the web as graph meshes of actions and links, at machine speed, logging everything back into Cortex. The browser humans don't need — agents do.
4. **Cortex OS** — The endgame. An operating system where the file system *is* the graph. Files exist as nodes connected by context, not folders. Agents navigate your entire digital life natively.

Every layer compounds the one below it. Memory → shared language → agent environment → operating system.

---

## 14. BRAND

- **Name:** Cortex.
- **Positioning:** Memory infrastructure. Not an app. Not a wrapper. The layer underneath.
- **Tagline:** **"One Memory. Every AI."**
- **Aesthetic:** Apple × SpaceX × Tesla. Industrial minimalism. Massive tight-tracked typography, monospace technical labels, hairline borders, sharp corners. Proper light/dark modes (designed separately, not inverted). 3D memory-mesh visuals. Zero neon, zero generic AI gradients.
- **Voice:** Precise, confident, engineering-first. We don't hype; we spec.

---

## 15. PROOF OF SUCCESS (HOW WE KNOW IT WORKS)

1. **Token Reduction Test:** 20 sessions, baseline vs. Cortex. Target: ≥90% fewer tokens with equal or better recall accuracy.
2. **Friction Test:** Correct the AI once ("never raw CSS"). It must never err again, in any chat, ever. 
3. **Forgetting Test:** Dentist appointment decays in weeks; "user is a developer" survives untouched. High-I memories survive 4 years at R ≥ 0.95.
4. **Cross-Model Test:** Teach GPT something on Monday. Ask Claude on Tuesday. Zero re-explanation.
5. **Latency Budget:** Full intercept→traverse→assemble→inject cycle < 20ms.
6. **Scale Test:** 1M nodes, query latency remains flat (logistic growth, pruning working).

---

## 16. GLOSSARY

| Term | Meaning |
|---|---|
| **Mesh** | The user's permanent semantic graph (SurrealDB) |
| **Node** | An atomic concept (deterministic hashed ID) |
| **Edge** | A typed, weighted relationship (Subject → Predicate → Object) |
| **S / Stability** | Reinforcement depth; grows logarithmically with use |
| **I / Impact** | Importance dampener (1–10); flattens decay for critical memories |
| **R(t) / Retention** | `e^(-t/(S·I))` — live memory health |
| **Pruning** | Hard deletion of decayed pathways (R < 0.05) |
| **State Overwrite** | Contradiction handling: zero old edge, redirect predicate |
| **Amygdala Rule** | Non-decaying procedural directive from user corrections |
| **Shadow Kernel** | Batch extraction model converting logs → triplets |
| **Assembler** | Compressor producing the ≤500-token JSON-LD briefing |
| **Hydrator** | Day-one historical import pipeline |
| **Briefing** | The single compressed context block injected into prompts |

---

*Cortex. Memory, permanently.*
```

---

That is the complete artifact. Everything we designed across this entire conversation is in there — the biology, the math, the graph, the MCP channel, the sync protocol, the UI, the hydrator, the monetization, the ecosystem, the brand. No phases, no MVP hedging. The god beast, as requested.

Put it in your repo root as `cortex.md`, and any IDE — Claude Code, Cursor, Antigravity, whatever — can ingest it and start building. When you're ready to start generating code, you already have the foundation prompt from earlier. Go build the empire.