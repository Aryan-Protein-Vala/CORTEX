use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct CrawlerConfig {
    pub watch_dirs: Vec<String>,
}

pub struct CrawlerEngine {
    pub config: Option<CrawlerConfig>,
}

impl CrawlerEngine {
    pub fn new() -> Self {
        Self { config: None }
    }
    
    pub fn update_config(&mut self, config: CrawlerConfig) -> Result<()> {
        println!("👀 Crawler configured to watch {} directories", config.watch_dirs.len());
        self.config = Some(config);
        self.start_watching();
        Ok(())
    }

    fn start_watching(&self) {
        if let Some(config) = &self.config {
            for dir in &config.watch_dirs {
                println!("🔍 Autonomous Crawler (Free Tier: Fast AST/Regex mode) attached to: {}", dir);
                // In a production implementation, we would spawn a `notify` file watcher here 
                // and extract semantic triplets on file saves or `git commit` hooks.
            }
        }
    }
}
