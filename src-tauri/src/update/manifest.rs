//! Update-manifest types matching Tauri 2.x `latest.json` schema, plus a
//! pure validator that rejects malformed input fail-fast.
//!
//! # Required vs optional fields
//!
//! `notes` and `pub_date` are required `String` (not `Option<String>`) by
//! deliberate Phase 1 choice. Phase 5 CI controls manifest generation; missing
//! fields = bug worth failing on. If Phase 3 ever consumes external manifests,
//! switch these to `Option<String>` then.
//!
//! See `RESEARCH.md` §4.3 for the trade-off analysis.

use crate::update::version::{parse_semver, ParseError};
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt;

/// Top-level Tauri updater manifest.
///
/// Field naming matches Tauri 2.x schema exactly (`pub_date` is snake_case in
/// the JSON; do NOT add `serde(rename = "pubDate")`).
#[derive(Deserialize, Debug)]
pub struct UpdateManifest {
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub platforms: HashMap<String, PlatformAsset>,
}

/// Per-platform asset descriptor. `signature` is the content of the `.sig` file
/// generated alongside the artifact during `tauri build`.
#[derive(Deserialize, Debug)]
pub struct PlatformAsset {
    pub signature: String,
    pub url: String,
}

/// Hand-rolled validation-error enum (no `thiserror` dep). Each variant carries
/// the context needed to debug a malformed manifest.
#[derive(Debug)]
pub enum ManifestError {
    InvalidVersion(ParseError),
    EmptyPlatforms,
    NonHttpsUrl { platform: String, url: String },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ManifestError::InvalidVersion(parse_error) => {
                write!(f, "manifest version is invalid: {parse_error}")
            }
            ManifestError::EmptyPlatforms => {
                write!(f, "manifest has no platform entries")
            }
            ManifestError::NonHttpsUrl { platform, url } => {
                write!(
                    f,
                    "manifest platform {platform:?} url is not https: {url:?}"
                )
            }
        }
    }
}

impl std::error::Error for ManifestError {}

/// Look up a single platform asset by key (e.g. `"windows-x86_64"`).
///
/// Returns a borrow into the manifest's internal `HashMap`. No clone — callers
/// that need an owned copy can `.cloned()` themselves at the call site.
pub fn asset_for_platform<'a>(
    manifest: &'a UpdateManifest,
    platform_key: &str,
) -> Option<&'a PlatformAsset> {
    manifest.platforms.get(platform_key)
}

/// Validate a deserialized manifest. Returns `Err` on the first violation
/// (fail-fast Tiger-Style — no aggregated error list).
///
/// Checks performed:
/// 1. `manifest.version` parses as semver.
/// 2. `manifest.platforms` is non-empty.
/// 3. Every `PlatformAsset.url` starts with the literal ASCII prefix `https://`.
///
/// The https check is **case-sensitive prefix** — whitespace-prefixed URLs and
/// uppercase scheme (`HTTPS://`) are rejected by design. Manifest is machine
/// generated, so any deviation = bug.
pub fn validate(manifest: &UpdateManifest) -> Result<(), ManifestError> {
    parse_semver(&manifest.version).map_err(ManifestError::InvalidVersion)?;
    if manifest.platforms.is_empty() {
        return Err(ManifestError::EmptyPlatforms);
    }
    for (platform, asset) in &manifest.platforms {
        if !asset.url.starts_with("https://") {
            return Err(ManifestError::NonHttpsUrl {
                platform: platform.clone(),
                url: asset.url.clone(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manifest(version: &str, url: &str) -> UpdateManifest {
        let mut platforms = HashMap::new();
        platforms.insert(
            "windows-x86_64".to_string(),
            PlatformAsset {
                signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZw==".to_string(),
                url: url.to_string(),
            },
        );
        UpdateManifest {
            version: version.to_string(),
            notes: "Bug fixes".to_string(),
            pub_date: "2026-05-01T12:00:00Z".to_string(),
            platforms,
        }
    }

    #[test]
    fn manifest_validates_https_urls() {
        let mut manifest = make_manifest(
            "0.1.3",
            "https://github.com/roulendz/ChurchAudioStream/releases/download/v0.1.3/ChurchAudioStream_0.1.3_x64-setup.nsis.zip",
        );
        manifest.platforms.insert(
            "darwin-aarch64".to_string(),
            PlatformAsset {
                signature: "sigtwo".to_string(),
                url: "https://example.com/macos.tar.gz".to_string(),
            },
        );
        assert!(validate(&manifest).is_ok());
    }

    #[test]
    fn manifest_rejects_http_url() {
        let manifest = make_manifest("0.1.3", "http://example.com/insecure.zip");
        let err = validate(&manifest).unwrap_err();
        assert!(matches!(
            err,
            ManifestError::NonHttpsUrl { ref platform, ref url }
                if platform == "windows-x86_64" && url == "http://example.com/insecure.zip"
        ));
    }

    #[test]
    fn manifest_rejects_uppercase_scheme() {
        // Documented behavior: case-sensitive prefix check (RESEARCH.md §4.4)
        let manifest = make_manifest("0.1.3", "HTTPS://example.com/x.zip");
        let err = validate(&manifest).unwrap_err();
        assert!(matches!(err, ManifestError::NonHttpsUrl { .. }));
    }

    #[test]
    fn manifest_rejects_empty_platforms() {
        let manifest = UpdateManifest {
            version: "0.1.3".to_string(),
            notes: "x".to_string(),
            pub_date: "2026-05-01T12:00:00Z".to_string(),
            platforms: HashMap::new(),
        };
        let err = validate(&manifest).unwrap_err();
        assert!(matches!(err, ManifestError::EmptyPlatforms));
    }

    #[test]
    fn manifest_rejects_invalid_version() {
        let manifest = make_manifest("abc", "https://example.com/x.zip");
        let err = validate(&manifest).unwrap_err();
        assert!(matches!(err, ManifestError::InvalidVersion(_)));
    }

    #[test]
    fn asset_for_platform_returns_match() {
        let manifest = make_manifest("0.1.3", "https://example.com/win.zip");
        let asset = asset_for_platform(&manifest, "windows-x86_64");
        assert!(asset.is_some());
        assert_eq!(asset.unwrap().url, "https://example.com/win.zip");
    }

    #[test]
    fn asset_for_platform_returns_none_for_unknown() {
        let manifest = make_manifest("0.1.3", "https://example.com/win.zip");
        assert!(asset_for_platform(&manifest, "unknown-key").is_none());
    }

    #[test]
    fn manifest_deserializes_from_json() {
        let json = r#"{
            "version": "0.1.3",
            "notes": "Bug fixes",
            "pub_date": "2026-05-01T12:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IC4uLg==",
                    "url": "https://github.com/roulendz/ChurchAudioStream/releases/download/v0.1.3/test.nsis.zip"
                }
            }
        }"#;
        let manifest: UpdateManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.version, "0.1.3");
        assert_eq!(manifest.notes, "Bug fixes");
        assert_eq!(manifest.pub_date, "2026-05-01T12:00:00Z");
        assert_eq!(manifest.platforms.len(), 1);
        let asset = manifest.platforms.get("windows-x86_64").unwrap();
        assert_eq!(
            asset.signature,
            "dW50cnVzdGVkIGNvbW1lbnQ6IC4uLg=="
        );
        assert!(asset.url.starts_with("https://"));
    }

    #[test]
    fn manifest_error_displays_human_readable() {
        let empty = format!("{}", ManifestError::EmptyPlatforms);
        assert_eq!(empty, "manifest has no platform entries");

        let non_https = format!(
            "{}",
            ManifestError::NonHttpsUrl {
                platform: "windows-x86_64".to_string(),
                url: "http://x".to_string(),
            }
        );
        assert!(non_https.contains("windows-x86_64"));
        assert!(non_https.contains("http://x"));
    }
}
