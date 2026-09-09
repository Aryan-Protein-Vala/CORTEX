use anyhow::{Result, Context};
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use crate::types::SemanticTriplet;

const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
// Using a fast, free model for extraction as per user instructions
const DEFAULT_MODEL: &str = "google/gemini-flash-1.5-8b";

#[derive(Clone)]
pub struct OpenRouterClient {
    client: Client,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    response_format: Option<ResponseFormat>,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

impl OpenRouterClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model: DEFAULT_MODEL.to_string(),
        }
    }
    
    pub fn with_model(mut self, model: &str) -> Self {
        self.model = model.to_string();
        self
    }
    
    /// The "Shadow Kernel" extraction prompt
    pub async fn extract_triplets(&self, session_log: &str) -> Result<Vec<SemanticTriplet>> {
        let system_prompt = r#"
Identity: You are a strict semantic extraction kernel.
Task: Analyze the conversation log. Output entities, concepts, and their explicit inter-relations.

Constraints:
1. Output MUST be a valid JSON array of relationship objects.
2. Do NOT summarize. Decompose into Subject -> Predicate -> Object triplets.
3. Assign Impact Factor (1–10): emotional depth, future plans, core identity, and corrections score 8–10. Trivia scores 1–3.
4. Normalize predicates to snake_case verbs ("proficient_in", "founded", "dislikes").
5. If a triplet CONTRADICTS a supplied existing-fact list, emit it with flag "overwrite": true.
6. The JSON array must contain objects with fields: "subject", "predicate", "object", "confidence" (0.0-1.0), "impact" (1-10), "overwrite" (boolean).
"#;

        let req_body = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message { role: "system".to_string(), content: system_prompt.to_string() },
                Message { role: "user".to_string(), content: session_log.to_string() }
            ],
            // Request JSON mode
            response_format: Some(ResponseFormat { format_type: "json_object".to_string() }) 
        };

        let res = self.client.post(OPENROUTER_API_URL)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "http://localhost:3000") // Required by OpenRouter
            .header("X-Title", "Cortex Core Engine")
            .json(&req_body)
            .send()
            .await
            .context("Failed to send request to OpenRouter")?;

        let res_text = res.text().await?;
        
        // Parse the JSON response
        let chat_response: ChatResponse = serde_json::from_str(&res_text)
            .context("Failed to parse JSON response from OpenRouter")?;
            
        let content = &chat_response.choices[0].message.content;
        
        // Sometimes LLMs wrap JSON in ```json ... ``` even with json_object format
        let clean_content = content.trim()
            .strip_prefix("```json").unwrap_or(content)
            .strip_suffix("```").unwrap_or(content)
            .trim();
            
        let triplets: Vec<SemanticTriplet> = serde_json::from_str(clean_content)
            .context("Failed to parse semantic triplets from LLM response")?;
            
        Ok(triplets)
    }
}
