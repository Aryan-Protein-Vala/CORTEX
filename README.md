# CORTEX 🧠

**The Gigabrain Universal Memory Protocol that makes other AIs look like amnesiac goldfishes.**

Let's get one thing straight: AI memory right now is absolute garbage. Every single AI (ChatGPT, Claude, Gemini, Cursor) is locked in its own stupid, isolated silo. They forget who you are, what you care about, and what you did yesterday. The only way to fix it is to dump 100,000 tokens of context into every prompt and pray to God you don't go bankrupt paying OpenAI's API fees.

We got tired of this shit. So we built **Cortex**.

## What is this sorcery?
Cortex is a Local-First, Graph-Vector Hybrid, O(1) Memory Engine built in blazing-fast Rust. 

We mathematically decoupled "memory" from "reasoning".

1. **You talk to your AI.** (We don't care which one).
2. **Cortex intercepts it.** Our background Shadow Kernel extracts the pure semantic truth (JSON-LD Triplets).
3. **We Graph it.** We map the relationships in SurrealDB.
4. **We Vector it.** We use Qdrant strictly as a fast-lookup doormat.
5. **We Decay the junk.** Our Rust engine runs actual biological Ebbinghaus Decay math. Useless shit fades away. Core identity facts stay forever.
6. **We inject it.** Next time you talk to *any* AI, we inject a tiny, hyper-dense context packet into the prompt. 

**Zero API bloat. Zero latency. Infinite memory.**

## Why it's the BESTEST technology ever built:
- **Telepathy between AIs:** Code in Cursor, and Claude instantly knows about it 5 minutes later on the web. They all read from the same goddamn Hive Mind.
- **Save your wallet:** Stop paying linear token costs for context windows. With Cortex, your memory token cost is flat. Forever.
- **Visual Digital Soul:** Watch your memory graph live on a 3D WebGL canvas. See memories pulse when accessed and fade into darkness when decayed.

## Run this beast
If you don't know how to run Docker and Rust, close this tab. 
If you aren't a peasant:
```bash
cd cortex-core
docker compose up -d
cargo run
```

*Welcome to the Hive Mind. Big Tech is absolutely cooked.*
