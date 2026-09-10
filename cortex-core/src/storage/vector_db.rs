use anyhow::{Result, Context};
use qdrant_client::qdrant::{
    PointStruct, SearchPointsBuilder, Value as QdrantValue, Vector, UpsertPointsBuilder
};
use qdrant_client::Qdrant;
use uuid::Uuid;

pub struct VectorIndex {
    client: Qdrant,
    collection_name: String,
}

impl VectorIndex {
    pub fn new(url: &str, collection_name: &str) -> Result<Self> {
        let client = Qdrant::from_url(url).build().context("Failed to build Qdrant client")?;
        
        Ok(Self {
            client,
            collection_name: collection_name.to_string(),
        })
    }

    /// Ensure that the Qdrant collection exists with appropriate vector dimensions
    pub async fn ensure_collection(&self) -> Result<()> {
        use qdrant_client::qdrant::{CreateCollectionBuilder, Distance, VectorParamsBuilder};
        
        if let Ok(exists) = self.client.collection_exists(&self.collection_name).await {
            if !exists {
                let params = VectorParamsBuilder::new(128, Distance::Cosine).build();
                let request = CreateCollectionBuilder::new(&self.collection_name)
                    .vectors_config(params)
                    .build();
                let _ = self.client.create_collection(request).await;
            }
        }
        Ok(())
    }

    /// Generate a normalized deterministic semantic vector from raw text
    pub fn embed_text(&self, text: &str) -> Vec<f32> {
        use sha2::{Sha256, Digest};
        let dim = 128;
        let mut vec = vec![0.0f32; dim];
        let lower = text.to_lowercase();
        let words: Vec<&str> = lower.split_whitespace().collect();
        
        if words.is_empty() {
            return vec;
        }
        
        for word in words {
            let mut hasher = Sha256::new();
            hasher.update(word.as_bytes());
            let hash = hasher.finalize();
            for i in 0..dim {
                let byte_idx = i % hash.len();
                let val = (hash[byte_idx] as f32 / 255.0) - 0.5;
                vec[i] += val;
            }
        }
        
        let norm = (vec.iter().map(|v| v * v).sum::<f32>()).sqrt();
        if norm > 0.0 {
            for v in vec.iter_mut() {
                *v /= norm;
            }
        }
        vec
    }
    
    /// Map text to an existing node ID via semantic search
    pub async fn map_to_node(&self, query_vector: Vec<f32>, top_k: u64) -> Result<Vec<String>> {
        let search_request = SearchPointsBuilder::new(
            &self.collection_name,
            query_vector,
            top_k
        )
        .with_payload(true)
        .build();
        
        let response = self.client.search_points(search_request).await?;
        
        let mut node_ids = Vec::new();
        for scored_point in response.result {
            if let Some(payload) = scored_point.payload.get("node_id") {
                if let Some(node_id) = payload.kind.as_ref().and_then(|k| match k {
                    qdrant_client::qdrant::value::Kind::StringValue(s) => Some(s.clone()),
                    _ => None,
                }) {
                    node_ids.push(node_id);
                }
            }
        }
        
        Ok(node_ids)
    }
    
    /// Insert a new embedding pointing to a Node ID
    pub async fn upsert_mapping(&self, node_id: &str, vector: Vec<f32>) -> Result<()> {
        let mut payload = std::collections::HashMap::new();
        payload.insert(
            "node_id".to_string(),
            QdrantValue {
                kind: Some(qdrant_client::qdrant::value::Kind::StringValue(node_id.to_string())),
            },
        );
        
        let point = PointStruct {
            id: Some(Uuid::new_v4().to_string().into()),
            vectors: Some(Vector::from(vector).into()),
            payload,
        };
        
        let upsert_request = UpsertPointsBuilder::new(&self.collection_name, vec![point]);
        self.client.upsert_points(upsert_request).await?;
        
        Ok(())
    }
}
