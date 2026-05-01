//! Pure decision functions for the auto-updater orchestrator.
//!
//! Zero IO, zero Tauri imports, zero clock calls (now_unix injected by caller).
//! All functions infallible at the boundary -- bad input folds into
//! UpdateDecision::SilentSkip(reason) strings, never panics, never returns Err.

use crate::update::manifest::{asset_for_platform, UpdateManifest};
use crate::update::version::parse_semver;

#[derive(Debug, PartialEq)]
pub enum UpdateDecision {
    Notify {
        version: String,
        notes: String,
        download_url: String,
    },
    SilentSkip(String),
    NoUpdate,
}

pub fn should_check_now(
    last_check_unix: i64,
    now_unix: i64,
    min_interval_seconds: i64,
) -> bool {
    debug_assert!(min_interval_seconds >= 0);

    if last_check_unix == 0 || now_unix < last_check_unix {
        return true;
    }
    now_unix.saturating_sub(last_check_unix) >= min_interval_seconds
}

pub fn is_version_skipped(version: &str, skipped: &[String]) -> bool {
    skipped.iter().any(|v| v == version)
}

pub fn evaluate_update(
    current: &str,
    manifest: &UpdateManifest,
    platform_key: &str,
    skipped: &[String],
    last_dismissed_unix: i64,
    now_unix: i64,
    dismiss_cooldown_seconds: i64,
) -> UpdateDecision {
    debug_assert!(now_unix >= 0);
    debug_assert!(dismiss_cooldown_seconds >= 0);

    let latest = match parse_semver(&manifest.version) {
        Err(error) => return UpdateDecision::SilentSkip(format!("bad manifest: {error}")),
        Ok(value) => value,
    };
    let current_parsed = match parse_semver(current) {
        Err(error) => return UpdateDecision::SilentSkip(format!("bad current: {error}")),
        Ok(value) => value,
    };
    if latest <= current_parsed {
        return UpdateDecision::NoUpdate;
    }
    if is_version_skipped(&manifest.version, skipped) {
        return UpdateDecision::SilentSkip("user skipped".to_string());
    }
    if now_unix.saturating_sub(last_dismissed_unix) < dismiss_cooldown_seconds {
        return UpdateDecision::SilentSkip("dismissed cooldown".to_string());
    }
    let asset = match asset_for_platform(manifest, platform_key) {
        None => return UpdateDecision::SilentSkip(format!("no asset for platform {platform_key}")),
        Some(asset) => asset,
    };
    UpdateDecision::Notify {
        version: manifest.version.clone(),
        notes: manifest.notes.clone(),
        download_url: asset.url.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::manifest::PlatformAsset;
    use std::collections::HashMap;

    fn make_manifest(version: &str, platform_key: &str, url: &str) -> UpdateManifest {
        let mut platforms = HashMap::new();
        platforms.insert(
            platform_key.to_string(),
            PlatformAsset {
                signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZw==".to_string(),
                url: url.to_string(),
            },
        );
        UpdateManifest {
            version: version.to_string(),
            notes: "release notes".to_string(),
            pub_date: "2026-05-01T12:00:00Z".to_string(),
            platforms,
        }
    }

    #[test]
    fn should_check_when_never_checked() {
        assert!(should_check_now(0, 1_000, 3_600));
    }

    #[test]
    fn should_not_check_within_cooldown() {
        let now = 1_700_000_000;
        assert!(!should_check_now(now - 100, now, 3_600));
    }

    #[test]
    fn should_check_after_cooldown_expires() {
        let now = 1_700_000_000;
        assert!(should_check_now(now - 7_200, now, 3_600));
    }

    #[test]
    fn should_check_when_clock_went_backward() {
        // Real backward-skew case: now < last (NTP correction or system clock reset).
        // Was previously gated by debug_assert!(now >= last) which made debug builds
        // panic on the exact case the function claims to handle. Assertion removed.
        assert!(should_check_now(1_700_000_000, 1_699_999_000, 3_600));
    }

    #[test]
    fn evaluate_handles_backward_clock_dismiss_without_underflow() {
        // Mirror of MA-01 / MI-02: now < last_dismissed must not panic in debug
        // (no debug_assert) and must not silently false-pass in release
        // (saturating_sub clamps to 0, so dismiss-cooldown check fires correctly).
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let now = 1_699_999_000_i64;
        let dismissed_in_future = 1_700_000_000_i64;
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &[],
            dismissed_in_future,
            now,
            86_400,
        );
        // saturating_sub returns 0, 0 < 86_400, so cooldown check fires → SilentSkip.
        assert_eq!(decision, UpdateDecision::SilentSkip("dismissed cooldown".to_string()));
    }

    #[test]
    fn evaluate_returns_notify_for_new_version() {
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        match decision {
            UpdateDecision::Notify { version, notes, download_url } => {
                assert_eq!(version, "0.1.3");
                assert_eq!(notes, "release notes");
                assert_eq!(download_url, "https://example.com/x.zip");
            }
            other => panic!("expected Notify, got {other:?}"),
        }
    }

    #[test]
    fn evaluate_returns_silent_skip_when_skipped() {
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let skipped = vec!["0.1.3".to_string()];
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &skipped,
            0,
            1_700_000_000,
            86_400,
        );
        assert_eq!(decision, UpdateDecision::SilentSkip("user skipped".to_string()));
    }

    #[test]
    fn evaluate_returns_silent_skip_within_dismiss_cooldown() {
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let now = 1_700_000_000;
        let dismissed_recently = now - 100;
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &[],
            dismissed_recently,
            now,
            86_400,
        );
        assert_eq!(decision, UpdateDecision::SilentSkip("dismissed cooldown".to_string()));
    }

    #[test]
    fn evaluate_returns_no_update_when_current_latest() {
        let manifest = make_manifest("0.1.2", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        assert_eq!(decision, UpdateDecision::NoUpdate);
    }

    #[test]
    fn evaluate_returns_no_update_when_downgrade() {
        let manifest = make_manifest("0.1.0", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "0.1.5",
            &manifest,
            "windows-x86_64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        assert_eq!(decision, UpdateDecision::NoUpdate);
    }

    #[test]
    fn evaluate_returns_silent_skip_when_no_asset_for_platform() {
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "darwin-aarch64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        assert_eq!(
            decision,
            UpdateDecision::SilentSkip("no asset for platform darwin-aarch64".to_string())
        );
    }

    #[test]
    fn evaluate_returns_silent_skip_for_bad_manifest_version() {
        let manifest = make_manifest("not-a-version", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "0.1.2",
            &manifest,
            "windows-x86_64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        match decision {
            UpdateDecision::SilentSkip(reason) => {
                assert!(reason.starts_with("bad manifest: "), "got: {reason}");
            }
            other => panic!("expected SilentSkip bad manifest, got {other:?}"),
        }
    }

    #[test]
    fn evaluate_returns_silent_skip_for_bad_current_version() {
        let manifest = make_manifest("0.1.3", "windows-x86_64", "https://example.com/x.zip");
        let decision = evaluate_update(
            "not-a-version",
            &manifest,
            "windows-x86_64",
            &[],
            0,
            1_700_000_000,
            86_400,
        );
        match decision {
            UpdateDecision::SilentSkip(reason) => {
                assert!(reason.starts_with("bad current: "), "got: {reason}");
            }
            other => panic!("expected SilentSkip bad current, got {other:?}"),
        }
    }
}
