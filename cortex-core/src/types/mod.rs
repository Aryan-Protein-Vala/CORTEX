use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Primary node in the knowledge graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryNode {
    /// Unique identifier (deterministic hash or UUID)
    pub id: String,
    
    /// Human-readable canonical label (e.g., "Python", "Startup Idea")
    pub label: String,
    
    /// Language-agnostic aliases for multilingual support
    #[serde(default)]
    pub aliases: Vec<String>,
    
    /// Stability factor (S) - Reinforcement depth (1.0-100.0)
    pub stability: f32,
    
    /// Impact factor (I) - Decay dampener (1-10)
    pub impact: u8,
    
    /// Amygdala lock - Never decays if true
    #[serde(default)]
    pub locked: bool,
    
    /// Category for UI grouping
    #[serde(default)]
    pub category: NodeCategory,
    
    /// Creation/Update timestamp
    pub updated_at: DateTime<Utc>,
    
    /// Last access timestamp for decay calculation
    pub last_accessed: DateTime<Utc>,
    
    /// Total access count (for reinforcement tracking)
    #[serde(default)]
    pub access_count: u32,
    
    /// Optional metadata (JSON object)
    #[serde(default)]
    pub metadata: serde_json::Value,
}

impl MemoryNode {
    pub fn new(label: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: format!("node:{}", Uuid::new_v4()), // We can change this to sha256 hash later based on label
            label: label.into(),
            aliases: vec![],
            stability: 1.0,
            impact: 5,
            locked: false,
            category: NodeCategory::General,
            updated_at: now,
            last_accessed: now,
            access_count: 0,
            metadata: serde_json::Value::Null,
        }
    }
    
    /// Mark as accessed (updates timestamp and count)
    pub fn mark_accessed(&mut self) {
        self.last_accessed = Utc::now();
        self.access_count += 1;
        
        // Logarithmic stability growth: S_new = S_old + ln(1 + hits)
        let growth = (1.0 + self.access_count as f32).ln();
        self.stability = (self.stability + growth).min(100.0);
    }
    
    /// Calculate current retention probability using Ebbinghaus
    pub fn retention_probability(&self) -> f32 {
        if self.locked { return 1.0; }
        
        let days_since_access = 
            (Utc::now() - self.last_accessed).num_seconds() as f32 / 86400.0;
        
        let decay_rate = days_since_access / (self.stability * self.impact as f32);
        
        (-decay_rate).exp()
    }
}

/// Node categories for UI organization
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeCategory {
    General,
    Technical,
    Personal,
    Project,
    Preference,
    Fact,
    Skill,
    Goal,
}

impl Default for NodeCategory {
    fn default() -> Self {
        Self::General
    }
}

/// Edge connecting two nodes (relationship)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationalEdge {
    /// Unique identifier
    pub id: String,
    
    /// Source node ID (subject)
    pub source: String,
    
    /// Target node ID (object)
    pub target: String,
    
    /// Relationship type (predicate)
    /// Examples: "proficient_in", "created", "prefers", "knows"
    pub predicate: String,
    
    /// Synaptic weight W (0.0-1.0)
    pub weight: f32,
    
    /// Superseded but remembered
    #[serde(default)]
    pub is_historical: bool,
    
    /// Creation timestamp
    pub created_at: DateTime<Utc>,
    
    /// Last reinforcement timestamp
    pub last_reinforced: DateTime<Utc>,
    
    /// Number of times this relationship was reinforced
    #[serde(default)]
    pub reinforcement_count: u32,
}

impl RelationalEdge {
    pub fn new(
        source: impl Into<String>,
        predicate: impl Into<String>,
        target: impl Into<String>,
        initial_weight: f32,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: format!("edge:{}", Uuid::new_v4()),
            source: source.into(),
            target: target.into(),
            predicate: predicate.into(),
            weight: initial_weight.clamp(0.0, 1.0),
            is_historical: false,
            created_at: now,
            last_reinforced: now,
            reinforcement_count: 0,
        }
    }
    
    /// Strengthen this edge (Long-Term Potentiation)
    pub fn reinforce(&mut self, amount: f32) {
        self.weight = (self.weight + amount).min(1.0);
        self.last_reinforced = Utc::now();
        self.reinforcement_count += 1;
    }
    
    /// Synaptic depression (applied during sweep)
    pub fn apply_depression(&mut self, percentage: f32) {
        self.weight *= 1.0 - percentage;
    }
}

/// Procedural rule from Amygdala Engine
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProceduralRule {
    pub rule_id: String,
    pub trigger_context: String,
    pub absolute_directive: String,
    pub created_at: i64,
    pub origin: String,
}

/// Semantic triplet (extracted from conversations by Shadow Kernel)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTriplet {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    
    #[serde(default = "default_confidence")]
    pub confidence: f32,
    
    #[serde(default = "default_impact")]
    pub impact: u8,
    
    #[serde(default)]
    pub overwrite: bool,
}

fn default_confidence() -> f32 { 0.7 }
fn default_impact() -> u8 { 5 }

/// Compressed context packet for injection
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CortexContextPacket {
    pub user_id: String,
    pub nodes: Vec<MemoryNode>,
    pub edges: Vec<RelationalEdge>,
    pub rules: Vec<ProceduralRule>,
    pub token_estimate: u32,
}

/// Working Memory Session State
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContext {
    pub session_id: String,
    pub user_id: String,
    pub chat_id: String,
    pub messages: Vec<Message>,
    pub started_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_topic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}
