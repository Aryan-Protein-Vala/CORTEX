import { NextResponse } from 'next/server';

const CORTEX_API_URL = process.env.NEXT_PUBLIC_CORTEX_API_URL || "http://localhost:3030";

export async function POST(req: Request) {
  try {
    const data = await req.json();
    
    // We expect the standard OpenAI conversations.json export format
    if (!Array.isArray(data)) {
      return NextResponse.json({ error: "Invalid format. Expected OpenAI conversations array." }, { status: 400 });
    }

    console.log(`🧠 [HYDRATOR] Received ${data.length} historical conversations.`);
    
    let processed = 0;
    // Process top conversations
    for (const conversation of data.slice(0, 10)) {
      let conversationTranscript = `Conversation: ${conversation.title || 'Untitled'}\n`;

      // Extract message texts from OpenAI mapping tree if present
      if (conversation.mapping && typeof conversation.mapping === 'object') {
        for (const nodeId of Object.keys(conversation.mapping)) {
          const node = conversation.mapping[nodeId];
          if (node && node.message && node.message.content && Array.isArray(node.message.content.parts)) {
            const role = node.message.author?.role || 'user';
            const text = node.message.content.parts.filter((p: unknown) => typeof p === 'string').join(' ');
            if (text.trim()) {
              conversationTranscript += `${role.toUpperCase()}: ${text.slice(0, 500)}\n`;
            }
          }
        }
      }

      const payload = {
        user_id: "default_user",
        prompt: conversationTranscript.slice(0, 4000), // bounded slice
        token_budget: 1000
      };

      try {
        const res = await fetch(`${CORTEX_API_URL}/v1/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          processed++;
        }
      } catch (e) {
        console.warn("Rust core unreachable during hydration turn.", e);
      }
    }

    return NextResponse.json({ 
      success: true, 
      processed,
      message: `Retroactive Hydration processed ${processed} conversations into the Hive Mind.`
    });

  } catch (error) {
    return NextResponse.json({ error: "Failed to parse or process JSON upload." }, { status: 500 });
  }
}
