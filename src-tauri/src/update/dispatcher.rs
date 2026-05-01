//! Tauri event payload TYPE definitions for the auto-updater.
//!
//! Phase 2 scope is types only. Phase 3 will wire app.emit("update:available", ...)
//! and friends. Keeping the types here in a pure-Rust module makes them
//! unit-testable (round-trip via serde_json) without booting Tauri.
//!
//! Wire format: camelCase, per Tauri 2.x IPC convention. CONTRAST: UpdateManifest
//! in manifest.rs is snake_case because it matches Tauri latest.json on-disk
//! schema. Different surfaces, different rules.

use serde::Serialize;

/// Emitted when an update is available and the user should be notified.
/// Field shape matches UpdateDecision::Notify from checker.rs.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAvailablePayload {
    pub version: String,
    pub notes: String,
    pub download_url: String,
}

/// Emitted periodically during download. u64 covers files larger than 4 GB.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgressPayload {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

/// Emitted after install completes (and before app restart).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstalledPayload {
    pub version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_available_payload_serializes_to_camel_case() {
        let payload = UpdateAvailablePayload {
            version: "0.1.3".to_string(),
            notes: "fixes".to_string(),
            download_url: "https://example.com/x.zip".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains(r#""version":"0.1.3""#), "json: {json}");
        assert!(json.contains(r#""notes":"fixes""#), "json: {json}");
        assert!(
            json.contains(r#""downloadUrl":"https://example.com/x.zip""#),
            "json: {json}"
        );
        assert!(!json.contains("download_url"), "snake_case leaked: {json}");
    }

    #[test]
    fn update_download_progress_payload_serializes() {
        let payload = UpdateDownloadProgressPayload {
            downloaded_bytes: 1_024,
            total_bytes: 4_096,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains(r#""downloadedBytes":1024"#), "json: {json}");
        assert!(json.contains(r#""totalBytes":4096"#), "json: {json}");
        assert!(!json.contains("downloaded_bytes"), "snake_case leaked: {json}");
        assert!(!json.contains("total_bytes"), "snake_case leaked: {json}");
    }

    #[test]
    fn update_installed_payload_serializes() {
        let payload = UpdateInstalledPayload {
            version: "0.1.3".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert_eq!(json, r#"{"version":"0.1.3"}"#);
    }
}
