use anyhow::{Result, Context};
use redis::{AsyncCommands, Client};
use crate::types::Message;

pub struct WorkingMemory {
    client: Client,
    prefix: String,
}

impl WorkingMemory {
    pub fn new(redis_url: &str) -> Result<Self> {
        let client = Client::open(redis_url)
            .context("Failed to connect to Dragonfly (Redis)")?;
            
        Ok(Self {
            client,
            prefix: "cortex:session:".to_string(),
        })
    }
    
    /// Append a message to the active session buffer
    pub async fn append_message(&self, session_id: &str, message: Message) -> Result<()> {
        let mut con = self.client.get_multiplexed_tokio_connection().await?;
        
        let key = format!("{}{}", self.prefix, session_id);
        let msg_json = serde_json::to_string(&message)?;
        
        // Use Redis List to store messages
        let _: () = con.rpush(&key, msg_json).await?;
        
        // Keep only last 10 messages
        let _: () = con.ltrim(&key, -10, -1).await?;
        
        // Set expiry to 15 minutes (session termination condition)
        let _: () = con.expire(&key, 900).await?;
        
        Ok(())
    }
    
    /// Retrieve full session context for Shadow Extraction
    pub async fn get_session(&self, session_id: &str) -> Result<Vec<Message>> {
        let mut con = self.client.get_multiplexed_tokio_connection().await?;
        
        let key = format!("{}{}", self.prefix, session_id);
        let messages_json: Vec<String> = con.lrange(&key, 0, -1).await?;
        
        let mut messages = Vec::new();
        for msg in messages_json {
            let parsed: Message = serde_json::from_str(&msg)?;
            messages.push(parsed);
        }
        
        Ok(messages)
    }
    
    /// Clear session after extraction
    pub async fn clear_session(&self, session_id: &str) -> Result<()> {
        let mut con = self.client.get_multiplexed_tokio_connection().await?;
        let key = format!("{}{}", self.prefix, session_id);
        let _: () = con.del(&key).await?;
        Ok(())
    }
}
