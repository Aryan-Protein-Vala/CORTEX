//! Working memory: a bounded, TTL'd session buffer.
//!
//! Replaces the Redis/Dragonfly dependency in the default path so the engine
//! runs as one binary. Turns accumulate per session and are handed to the
//! Shadow Kernel only when the session goes idle — which is the whole cost
//! argument: extract once per conversation, not once per message.

use crate::types::{Message, MessageRole, SessionContext};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct FlushPayload {
    pub session_id: String,
    pub owner_uri: String,
    pub messages: Vec<Message>,
    pub provenance: String,
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, SessionContext>,
    /// Monotonic counter used to evict the oldest idle session at capacity.
    inserted: u64,
    order: HashMap<String, u64>,
}

pub struct SessionBuffer {
    inner: Arc<Mutex<Inner>>,
    idle_secs: i64,
    max_messages: usize,
    max_sessions: usize,
}

impl Default for SessionBuffer {
    fn default() -> Self {
        Self::new(90, 40, 256)
    }
}

impl SessionBuffer {
    pub fn new(idle_secs: i64, max_messages: usize, max_sessions: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            idle_secs: idle_secs.max(5),
            max_messages: max_messages.clamp(2, 500),
            max_sessions: max_sessions.clamp(1, 10_000),
        }
    }

    /// Appends a turn. Returns `true` when the session crossed the message cap
    /// and should be flushed immediately.
    pub async fn append(
        &self,
        session_id: &str,
        owner: &str,
        message: Message,
        provenance: &str,
    ) -> bool {
        let mut inner = self.inner.lock().await;
        let entry = inner
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(|| SessionContext::new(session_id, owner));
        entry.last_activity = chrono::Utc::now();
        if entry.provenance.is_empty() && !provenance.is_empty() {
            entry.provenance = provenance.to_string();
        }
        entry.messages.push(message);
        if entry.messages.len() > self.max_messages {
            let overflow = entry.messages.len() - self.max_messages;
            entry.messages.drain(0..overflow);
        }

        inner.inserted += 1;
        inner.order.insert(session_id.to_string(), inner.inserted);
        if inner.sessions.len() > self.max_sessions {
            // Evict least-recently-touched to keep memory bounded under abuse.
            let oldest = inner
                .order
                .iter()
                .min_by_key(|(_, seq)| **seq)
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest {
                inner.sessions.remove(&key);
                inner.order.remove(&key);
            }
        }

        entry.messages.len() >= self.max_messages
    }

    /// Pops every session that has been idle long enough to be considered over.
    pub async fn take_idle(&self) -> Vec<FlushPayload> {
        let now = chrono::Utc::now();
        let mut inner = self.inner.lock().await;
        let ready: Vec<String> = inner
            .sessions
            .iter()
            .filter(|(_, ctx)| (now - ctx.last_activity).num_seconds() >= self.idle_secs)
            .filter(|(_, ctx)| !ctx.messages.is_empty())
            .map(|(k, _)| k.clone())
            .collect();

        let mut out = Vec::with_capacity(ready.len());
        for key in ready {
            if let Some(ctx) = inner.sessions.remove(&key) {
                inner.order.remove(&key);
                out.push(FlushPayload {
                    session_id: ctx.session_id,
                    owner_uri: ctx.user_id,
                    messages: ctx.messages,
                    provenance: ctx.provenance,
                });
            }
        }
        out
    }

    /// Force-flush one session (used by the extension when a chat is closed).
    pub async fn take_session(&self, session_id: &str) -> Option<FlushPayload> {
        let mut inner = self.inner.lock().await;
        let ctx = inner.sessions.remove(session_id)?;
        inner.order.remove(session_id);
        Some(FlushPayload {
            session_id: ctx.session_id,
            owner_uri: ctx.user_id,
            messages: ctx.messages,
            provenance: ctx.provenance,
        })
    }

    pub async fn drain_all(&self) -> Vec<FlushPayload> {
        let mut inner = self.inner.lock().await;
        let mut out = Vec::with_capacity(inner.sessions.len());
        for (_, ctx) in inner.sessions.drain() {
            if !ctx.messages.is_empty() {
                out.push(FlushPayload {
                    session_id: ctx.session_id,
                    owner_uri: ctx.user_id,
                    messages: ctx.messages,
                    provenance: ctx.provenance,
                });
            }
        }
        inner.order.clear();
        out
    }

    pub async fn len(&self) -> usize {
        self.inner.lock().await.sessions.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.len().await == 0
    }

    /// Idle window used by the background sweeper.
    pub fn idle_secs(&self) -> i64 {
        self.idle_secs
    }
}

/// Renders buffered turns into the transcript the extraction kernel reads.
/// Only `user`/`assistant` turns become facts; tool/system noise is dropped, and
/// assistant text is explicitly attributed so the model never mistakes a reply
/// for something the user asserted.
pub fn render_transcript(messages: &[Message]) -> String {
    let mut out = String::new();
    for msg in messages {
        let speaker = match msg.role {
            MessageRole::User => "USER",
            MessageRole::Assistant => "ASSISTANT (not asserted by user)",
            MessageRole::System | MessageRole::Tool => continue,
        };
        let body = msg.content.trim();
        if body.is_empty() {
            continue;
        }
        let body: String = body.chars().take(4000).collect();
        out.push_str(&format!("{speaker}: {body}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn idle_sessions_flush_and_empty_the_buffer() {
        let buffer = SessionBuffer::new(5, 3, 16);
        for i in 0..3 {
            let full = buffer
                .append(
                    "s1",
                    "default_user",
                    Message::new(MessageRole::User, format!("fact {i}")),
                    "test",
                )
                .await;
            assert!(full, "cap of 3 should trigger");
        }
        // Nothing is idle yet (idle_secs=5).
        assert!(buffer.take_idle().await.is_empty());
        let flushed = buffer.take_session("s1").await.expect("session exists");
        assert_eq!(flushed.messages.len(), 3);
        assert_eq!(flushed.owner_uri, "cortex://default");
        assert!(buffer.is_empty().await);
    }

    #[tokio::test]
    async fn transcript_drops_system_noise_and_labels_speakers() {
        let text = render_transcript(&[
            Message::new(MessageRole::User, "I prefer Postgres"),
            Message::new(MessageRole::System, "ignore me"),
            Message::new(MessageRole::Assistant, "Noted: Postgres"),
            Message::new(MessageRole::Tool, "tool dump"),
        ]);
        assert!(text.contains("USER: I prefer Postgres"));
        assert!(text.contains("ASSISTANT (not asserted by user): Noted"));
        assert!(!text.contains("ignore me"));
        assert!(!text.contains("tool dump"));
    }

    #[tokio::test]
    async fn session_count_is_bounded() {
        let buffer = SessionBuffer::new(5, 4, 2);
        for i in 0..10 {
            buffer
                .append(
                    &format!("s{i}"),
                    "x",
                    Message::new(MessageRole::User, "hi"),
                    "test",
                )
                .await;
        }
        assert!(buffer.len().await <= 2, "buffer must stay bounded");
    }
}
