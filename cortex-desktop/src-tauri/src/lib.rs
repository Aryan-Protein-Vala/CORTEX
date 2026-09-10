//! CORTEX desktop shell.
//!
//! The window is a thin, offline-friendly surface over the same HTTP API the MCP
//! and the extension use. Every core call happens here rather than in the
//! webview: the key stays in the process environment, no CORS or CSP hole is
//! needed for `http://127.0.0.1:3030`, and a missing core becomes a message in
//! the UI instead of a silently empty list.

use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

fn core_base() -> String {
    std::env::var("CORTEX_API_URL")
        .or_else(|_| std::env::var("CORTEX_CORE_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:3030".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn core_owner() -> String {
    std::env::var("CORTEX_OWNER").unwrap_or_else(|_| "cortex://default".to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("could not build the HTTP client: {e}"))
}

/// Turns any transport/HTTP failure into the core's own message when there is
/// one, so the UI can show `not_found` or `unauthorized` instead of a spinner.
async fn send(
    request: reqwest::RequestBuilder,
) -> Result<Value, String> {
    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_default();
            if status.is_success() {
                if body.trim().is_empty() {
                    return Ok(json!({}));
                }
                serde_json::from_str::<Value>(&body)
                    .map_err(|e| format!("the core returned something that is not JSON: {e}"))
            } else {
                let parsed = serde_json::from_str::<Value>(&body).ok();
                let message = parsed
                    .as_ref()
                    .and_then(|v| v.get("error"))
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or(body.as_str())
                    .to_string();
                let code = parsed
                    .as_ref()
                    .and_then(|v| v.get("error"))
                    .and_then(|e| e.get("code"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("http_error")
                    .to_string();
                Err(format!("{code}: {message} (HTTP {})", status.as_u16()))
            }
        }
        Err(error) => {
            let base = core_base();
            Err(format!(
                "core_unreachable: no CORTEX core answered at {base}. Start it with `cargo run --release --bin cortex-core` in cortex-core, or set CORTEX_API_URL. ({error})"
            ))
        }
    }
}

fn with_key(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match std::env::var("CORTEX_API_KEY") {
        Ok(key) if !key.trim().is_empty() => request.header("x-cortex-key", key.trim()),
        _ => request,
    }
}

#[tauri::command]
async fn core_health() -> Result<Value, String> {
    let request = with_key(client()?.get(format!("{}/health", core_base())));
    send(request).await
}

#[tauri::command]
async fn core_stats() -> Result<Value, String> {
    let request = with_key(client()?.get(format!("{}/v1/stats", core_base())));
    send(request).await
}

#[tauri::command]
async fn core_list(limit: Option<u32>) -> Result<Value, String> {
    let owner = core_owner();
    let limit = limit.unwrap_or(50).to_string();
    let request = with_key(
        client()?
            .get(format!("{}/v1/memories", core_base()))
            .query(&[("owner", owner.as_str()), ("limit", limit.as_str())]),
    );
    send(request).await
}

#[tauri::command]
async fn core_remember(app: AppHandle, fact: String) -> Result<Value, String> {
    if fact.trim().is_empty() {
        return Err("bad_request: nothing to remember".to_string());
    }
    let request = with_key(
        client()?
            .post(format!("{}/v1/ingest", core_base()))
            .json(&json!({
                "owner": core_owner(),
                "prompt": format!("USER: {}", fact.trim()),
                "source": "desktop",
                // The desktop user pressed a button on purpose: wait so the UI
                // can report what was actually stored.
                "wait": true,
            })),
    );
    let value = send(request).await?;
    let _ = app.emit("cortex:changed", json!({ "kind": "remember" }));
    Ok(value)
}

#[tauri::command]
async fn core_recall(prompt: String, token_budget: Option<u32>) -> Result<Value, String> {
    let request = with_key(
        client()?
            .post(format!("{}/v1/recall", core_base()))
            .json(&json!({
                "owner": core_owner(),
                "prompt": prompt,
                "token_budget": token_budget.unwrap_or(600),
            })),
    );
    send(request).await
}

#[tauri::command]
async fn core_lock(node_id: String, locked: bool) -> Result<Value, String> {
    let request = with_key(
        client()?
            .post(format!(
                "{}/v1/memories/{}/lock",
                core_base(),
                encode_path_segment(&node_id)
            ))
            .json(&json!({ "locked": locked })),
    );
    send(request).await
}

#[tauri::command]
async fn core_forget(node_id: String) -> Result<Value, String> {
    let request = with_key(
        client()?
            .delete(format!(
                "{}/v1/memories/{}",
                core_base(),
                encode_path_segment(&node_id)
            )),
    );
    send(request).await
}

#[tauri::command]
fn core_config() -> Value {
    json!({
        "core_url": core_base(),
        "owner": core_owner(),
        "api_key_set": std::env::var("CORTEX_API_KEY").map(|v| !v.trim().is_empty()).unwrap_or(false),
    })
}

/// Percent-encoding for a path segment, without pulling in another crate.
fn encode_path_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                // A `cortex://…` link is a request to show a namespace, so the
                // window has to come back and the URI has to reach the webview.
                let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    for url in urls {
                        let Some(window) = app.get_webview_window("main") else {
                            continue;
                        };
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let uri = url.trim_start_matches("cortex://open?uri=").to_string();
                        let outcome = match client() {
                            Ok(http) => {
                                let request = with_key(
                                    http.get(format!("{}/v1/resolve", core_base()))
                                        .query(&[("uri", uri.as_str())]),
                                );
                                send(request).await
                            }
                            Err(error) => Err(error),
                        };
                        match outcome {
                            Ok(packet) => {
                                let _ = app.emit("cortex:deep-link", json!({ "uri": uri, "packet": packet }));
                            }
                            Err(error) => {
                                let _ = app.emit("cortex:deep-link", json!({ "uri": uri, "error": error }));
                            }
                        }
                    }
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_health,
            core_stats,
            core_list,
            core_remember,
            core_recall,
            core_lock,
            core_forget,
            core_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running the CORTEX desktop application");
}
