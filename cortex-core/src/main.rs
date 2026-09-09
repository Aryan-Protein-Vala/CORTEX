pub mod types;
pub mod ai;
pub mod storage;
pub mod engine;
pub mod api;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Cortex Core Engine initializing...");
    api::server::start_server(3030).await?;
    Ok(())
}
