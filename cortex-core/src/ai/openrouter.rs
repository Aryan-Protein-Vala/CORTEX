//! OpenRouter LLM client for real triplet extraction.
//!
//! Free-tier OpenRouter models return prose, markdown fences, or a wrapper
//! object just as often as clean JSON. Every path here therefore (a) demands a
//! JSON object contract, (b) parses defensively, (c) reports *why* it gave up
//! so callers can say so instead of swallowing the failure.

use crate::types::SemanticTriplet;
use reqwest;
use serde::{Deserialize, Serialize};

pub const DEFAULT_MODEL: &str = "google/gemini-flash-1.5-8b";
pub const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

const SYSTEM_PROMPT: &str = r#"You are the CORTEX Shadow Kernel. You extract durable user memory as a typed semantic graph.

Return ONLY a JSON object: {"triplets":[{"subject":"...","predicate":"...","object":"...","confidence":0.0-1.0,"impact":0-10,"overwrite":bool}]}

Rules:
- Extract facts asserted by USER lines only. Never record claims made by ASSISTANT as facts about the user.
- subject/object: 2-5 word canonical labels (e.g. "React", "TypeScript", "Postgres"), never whole sentences, never pronouns alone.
- predicate: kebab-case or snake_case (e.g. "prefers", "works_with", "is_immune_to", "must", "must_not").
- impact 9-10 = identity, medical, permanent rules; 5-8 = strong preferences and decisions; 0-4 = transient context.
- overwrite=true when the user is correcting or replacing an earlier belief.
- Max 30 triplets. Use {"triplets":[]} if there is nothing durable. No commentary, no markdown."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct OpenRouterClient {
    http: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
}

impl OpenRouterClient {
    pub fn new(api_key: String) -> Self {
        Self::with_base(api_key, DEFAULT_MODEL.to_string(), DEFAULT_BASE_URL.to_string())
    }

    pub fn with_model(api_key: String, model: String) -> Self {
        Self::with_base(api_key, model, DEFAULT_BASE_URL.to_string())
    }

    fn with_base(api_key: String, model: String, base_url: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .connect_timeout(std::time::Duration::from_secs(10))
                .user_agent(concat!("cortex-core/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            api_key,
            model,
            base_url,
        }
    }

    /// Which model produced (or failed to produce) an extraction. Surfaced in
    /// the dashboard so "the memory is wrong" can be traced to a model choice.
    pub fn model_label(&self) -> String {
        self.model.clone()
    }

    pub fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }

    /// Extract semantic triplets from a conversation transcript.
    ///
    /// Errors are returned as `Err(String)` with a human-readable cause because
    /// the API layer reports them as a warning and continues on heuristics —
    /// a dead LLM must never take ingestion down with it.
    pub async fn extract_triplets(&self, transcript: &str) -> Result<Vec<SemanticTriplet>, String> {
        if !self.has_key() {
            return Err("OPENROUTER_API_KEY is not configured".to_string());
        }
        let trimmed = transcript.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let payload = serde_json::json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": trimmed },
            ],
            "temperature": 0.1,
            "max_tokens": 1400,
            // OpenRouter forwards this to the provider's native JSON mode.
            "response_format": { "type": "json_object" },
        });

        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let mut attempt = 0u8;
        let raw = loop {
            attempt += 1;
            let result = self
                .http
                .post(&url)
                .bearer_auth(&self.api_key)
                .header("HTTP-Referer", "https://cortex.page")
                .header("X-Title", "CORTEX Core")
                .json(&payload)
                .send()
                .await;

            match result {
                Ok(response) => {
                    let status = response.status();
                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                        if attempt < 2 {
                            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                            continue;
                        }
                        return Err(format!("openrouter upstream error: HTTP {status}"));
                    }
                    if !status.is_success() {
                        let body = response.text().await.unwrap_or_default();
                        return Err(format!(
                            "openrouter rejected the request: HTTP {status} — {}",
                            truncate(&body, 300)
                        ));
                    }
                    let text = response
                        .text()
                        .await
                        .map_err(|e| format!("openrouter unreadable response: {e}"))?;
                    break extract_content(&text)
                        .ok_or_else(|| "openrouter response had no message content".to_string())?;
                }
                Err(e) => {
                    if attempt < 2 {
                        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        continue;
                    }
                    return Err(format!("openrouter request failed: {e}"));
                }
            }
        };

        let triplets = parse_triplets(&raw);
        Ok(triplets)
    }
}

/// Pull `choices[0].message.content` out of a chat-completion response.
fn extract_content(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let content = value.get("choices")?.get(0)?.get("message")?.get("content")?;
    match content {
        serde_json::Value::String(s) => Some(s.clone()),
        // Some providers return a content-parts array.
        serde_json::Value::Array(parts) => Some(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    }
}

/// Parse model output into triplets, tolerating every shape free-tier models
/// actually produce: fenced blocks, `{"triplets":[...]}`, bare arrays, and one
/// JSON object per line.
pub fn parse_triplets(raw: &str) -> Vec<SemanticTriplet> {
    let cleaned = strip_fences(raw);
    let candidates = candidate_values(&cleaned);

    let mut out = Vec::new();
    for value in candidates {
        for item in triplet_items(&value) {
            let get = |keys: &[&str]| -> Option<String> {
                keys.iter().find_map(|k| {
                    item.get(*k).and_then(|v| match v {
                        serde_json::Value::String(s) => Some(s.clone()),
                        serde_json::Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    })
                })
            };
            let subject = get(&["subject", "s", "from"]);
            let predicate = get(&["predicate", "p", "relation", "type"]);
            let object = get(&["object", "o", "value", "to"]);
            let (Some(subject), Some(predicate), Some(object)) = (subject, predicate, object) else {
                continue;
            };
            let confidence = item
                .get("confidence")
                .and_then(|v| v.as_f64())
                .map(|c| c.clamp(0.0, 1.0) as f32)
                .unwrap_or(0.9);
            let impact = item
                .get("impact")
                .and_then(|v| v.as_f64().map(|i| i as i64).or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .map(|i| i.clamp(0, 10) as u8)
                .unwrap_or(5);
            let overwrite = item
                .get("overwrite")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let triplet = SemanticTriplet {
                subject,
                predicate,
                object,
                confidence,
                impact,
                overwrite,
                sentence: String::new(),
            }
            .sanitized();
            if triplet.is_valid() {
                out.push(triplet);
            }
        }
        if !out.is_empty() {
            break; // first shape that yielded triplets wins
        }
    }
    out.truncate(30);
    out
}

fn strip_fences(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Yield every plausible JSON value in the text, best shape first.
fn candidate_values(text: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        out.push(value);
    }
    // Grab the outermost object / array if the model added prose around it.
    for (open, close) in [('{', '}'), ('[', ']')] {
        if let Some(start) = text.find(open) {
            if let Some(end) = text.rfind(close) {
                if end > start {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text[start..=end]) {
                        out.push(value);
                    }
                }
            }
        }
    }
    // JSONL fallback: one object per line.
    let mut lines = Vec::new();
    for line in text.lines() {
        let t = line.trim().trim_end_matches(',');
        if t.starts_with('{') {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(t) {
                lines.push(value);
            }
        }
    }
    if !lines.is_empty() {
        out.push(serde_json::Value::Array(lines));
    }
    out
}

fn triplet_items(value: &serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(array) = value.as_array() {
        return array.clone();
    }
    for key in ["triplets", "memories", "facts", "edges", "results", "data"] {
        if let Some(array) = value.get(key).and_then(|v| v.as_array()) {
            return array.clone();
        }
    }
    // A single object without a wrapper.
    if value.is_object() {
        return vec![value.clone()];
    }
    Vec::new()
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_wrapped_object() {
        let raw = r#"{"triplets":[{"subject":"User","predicate":"prefers","object":"Rust","confidence":0.9,"impact":8,"overwrite":false}]}"#;
        let got = parse_triplets(raw);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].predicate, "prefers");
    }

    #[test]
    fn parses_fenced_bare_arrays_and_stray_prose() {
        let fenced = "```json\n[{\"subject\":\"A\",\"predicate\":\"uses\",\"object\":\"B\"}]\n```";
        assert_eq!(parse_triplets(fenced).len(), 1);
        let prose = "Sure! Here you go:\n[{\"subject\":\"A\",\"predicate\":\"uses\",\"object\":\"B\"}]\nHope that helps.";
        assert_eq!(parse_triplets(prose).len(), 1);
        let jsonl = "{\"subject\":\"A\",\"predicate\":\"uses\",\"object\":\"B\"}\n{\"subject\":\"C\",\"predicate\":\"uses\",\"object\":\"D\"}";
        assert_eq!(parse_triplets(jsonl).len(), 2);
    }

    #[test]
    fn accepts_alternative_field_names_and_clamps_numbers() {
        let raw = r#"[{"s":"User","relation":"hates","o":"MongoDB","confidence":9.5,"impact":"14"}]"#;
        let got = parse_triplets(raw);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].confidence, 1.0);
        assert_eq!(got[0].impact, 10);
    }

    #[test]
    fn garbage_and_empty_shapes_yield_nothing() {
        assert!(parse_triplets("I could not find any facts.").is_empty());
        assert!(parse_triplets("").is_empty());
        assert!(parse_triplets("{\"triplets\":[]}").is_empty());
        assert!(parse_triplets("[{\"subject\":\"a\"}]").is_empty());
    }

    #[test]
    fn output_is_capped() {
        let items: Vec<String> = (0..200)
            .map(|i| format!(r#"{{"subject":"S{i}","predicate":"p","object":"O{i}"}}"#))
            .collect();
        let raw = format!("[{}]", items.join(","));
        assert_eq!(parse_triplets(&raw).len(), 30);
    }

    #[test]
    fn missing_key_is_reported_not_silently_ignored() {
        let client = OpenRouterClient::new(String::new());
        assert!(!client.has_key());
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(client.extract_triplets("USER: I prefer Rust"))
            .unwrap_err();
        assert!(err.contains("OPENROUTER_API_KEY"));
    }
}
