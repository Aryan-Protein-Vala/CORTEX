use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.deep_link().on_open_url(|event| {
                let client = reqwest::blocking::Client::new();
                for url in event.urls() {
                    println!("🧠 Intercepted cortex:// deep link: {}", url);
                    if let Ok(mut endpoint) = reqwest::Url::parse("http://localhost:3030/v1/resolve") {
                        endpoint.query_pairs_mut().append_pair("uri", url.as_str());
                        let _ = client.get(endpoint).send();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
