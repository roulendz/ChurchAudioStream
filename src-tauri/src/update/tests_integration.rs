#![cfg(all(feature = "integration", test))]

//! Integration tests gated by `--features integration` AND `cargo test`.
//! `tempfile` is a `[dev-dependencies]`-only crate, so this module must NOT
//! compile under `cargo build --features integration` (non-test). The `test`
//! cfg flag scopes the import to test builds where dev-deps are linked.
//!
//! These exercise UpdateState round-trip via real storage IO + evaluate_update
//! against fixtures. Same pure-Rust pattern as Phase 2 inline tests; flag is the
//! master-plan §3 step 7 requirement (lines 382-388).

use crate::update::checker::{evaluate_update, UpdateDecision};
use crate::update::manifest::{PlatformAsset, UpdateManifest};
use crate::update::storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version, UpdateState,
};
use std::collections::HashMap;
use tempfile::tempdir;

fn fixture_manifest(version: &str, url: &str) -> UpdateManifest {
    let mut platforms = HashMap::new();
    platforms.insert(
        "windows-x86_64".to_string(),
        PlatformAsset {
            signature: "sig".into(),
            url: url.into(),
        },
    );
    UpdateManifest {
        version: version.into(),
        notes: "release notes".into(),
        pub_date: "2026-05-01T00:00:00Z".into(),
        platforms,
    }
}

#[test]
fn test_update_state_persists_across_load_save() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("update-state.json");

    let mut s = UpdateState::default();
    s = with_check_completed(s, 1_000);
    s = with_dismissed_now(s, 2_000);
    s = with_skipped_version(s, "0.2.0");
    save(&path, &s).unwrap();

    let loaded = load(&path).unwrap();
    assert_eq!(loaded, s);
    assert_eq!(loaded.last_check_unix, 1_000);
    assert_eq!(loaded.last_dismissed_unix, 2_000);
    assert_eq!(loaded.skipped_versions, vec!["0.2.0".to_string()]);
}

#[test]
fn test_skip_version_then_check_returns_silent_skip() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let skipped = vec!["0.2.0".to_string()];
    let decision = evaluate_update(
        "0.1.0",
        &manifest,
        "windows-x86_64",
        &skipped,
        0,
        10_000,
        86_400,
    );
    match decision {
        UpdateDecision::SilentSkip(reason) => {
            assert!(reason.contains("0.2.0") || reason.contains("skip"))
        }
        other => panic!("expected SilentSkip, got {other:?}"),
    }
}

#[test]
fn test_dismiss_then_check_within_cooldown_returns_silent_skip() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let now = 100_000;
    let dismissed_recently = now - 3_600;
    let decision = evaluate_update(
        "0.1.0",
        &manifest,
        "windows-x86_64",
        &[],
        dismissed_recently,
        now,
        86_400,
    );
    assert!(
        matches!(decision, UpdateDecision::SilentSkip(_)),
        "expected SilentSkip during cooldown, got {decision:?}"
    );
}

#[test]
fn test_dismiss_after_cooldown_returns_notify() {
    let manifest = fixture_manifest("0.2.0", "https://example.com/installer.exe");
    let now = 1_000_000;
    let dismissed_long_ago = now - (25 * 3_600);
    let decision = evaluate_update(
        "0.1.0",
        &manifest,
        "windows-x86_64",
        &[],
        dismissed_long_ago,
        now,
        86_400,
    );
    match decision {
        UpdateDecision::Notify { version, .. } => assert_eq!(version, "0.2.0"),
        other => panic!("expected Notify after cooldown, got {other:?}"),
    }
}
