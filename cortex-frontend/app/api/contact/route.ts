import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, message } = body;

    if (!name || !email || !message) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }

    console.log(`📩 [CORTEX CONTACT] New submission from ${name} (${email}): ${message.slice(0, 100)}...`);

    return NextResponse.json({
      success: true,
      message: "Transmission received. Our core engineers will reach out."
    });
  } catch {
    return NextResponse.json({ error: "Failed to process contact submission." }, { status: 500 });
  }
}
