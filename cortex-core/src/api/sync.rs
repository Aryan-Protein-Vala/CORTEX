//! Phase 10 in `cortex2.md`: CRDT sync between a local core and CORTEX Cloud.
//!
//! **This is not implemented.** It is kept compiled (and honest) on purpose:
//! `cortex-core` runs entirely offline, `api::server` reports
//! `cloud_sync: false`, and nothing in the product pretends data is being
//! replicated. The proto/tonic build step for this never landed, so
//! `build.rs` does not exist and the generated types below are not referenced.
//!
//! What a real implementation needs, in order:
//! 1. `cortex.proto` + `build.rs` (`tonic-build`) generating the client.
//! 2. A per-node vector clock (the CRDT half — without it, merges are LWW and
//!    concurrent edits silently lose).
//! 3. Server-side auth (account-scoped namespace), TLS, and a schema version
//!    gate before any write.
//! 4. Redaction: only nodes/edges the user has explicitly opted into may leave
//!    the device; identity and medical facts must be excluded by default.

use anyhow::{bail, Result};

/// Handle for the sync subsystem. Constructing it does not connect anywhere.
#[derive(Debug, Clone)]
pub struct CloudSyncNode {
    cloud_url: String,
    user_id: String,
    /// Sync is only attempted when this is true; see `disabled()`.
    enabled: bool,
}

impl CloudSyncNode {
    /// The default for every local install.
    pub fn disabled() -> Self {
        Self {
            cloud_url: String::new(),
            user_id: String::new(),
            enabled: false,
        }
    }

    pub fn new(cloud_url: &str, user_id: &str) -> Self {
        Self {
            cloud_url: cloud_url.to_string(),
            user_id: user_id.to_string(),
            enabled: false,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.enabled && !self.cloud_url.trim().is_empty()
    }

    /// Always fails with a precise reason. Callers surface this as a warning or
    /// a 501 — never as a success, which is what the previous stub did.
    pub async fn trigger_sync(&self) -> Result<()> {
        bail!(
            "CORTEX Cloud sync is not implemented (target {}); local memory is the only supported mode",
            if self.cloud_url.is_empty() { "unset" } else { &self.cloud_url }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sync_is_explicitly_unavailable() {
        let node = CloudSyncNode::disabled();
        assert!(!node.is_configured());
        let err = node.trigger_sync().await.unwrap_err().to_string();
        assert!(err.contains("not implemented"), "unhelpful error: {err}");
    }

    #[tokio::test]
    async fn a_configured_url_still_refuses_to_sync() {
        let node = CloudSyncNode::new("https://cloud.example", "u1");
        assert!(!node.is_configured());
        assert!(node.trigger_sync().await.is_err());
    }
}
