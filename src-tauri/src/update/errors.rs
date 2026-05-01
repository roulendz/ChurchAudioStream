//! Phase 3 typed error enum wrapping Phase 1+2 errors plus Tauri runtime errors.
//!
//! Hand-rolled `Display` + empty `std::error::Error` + `From` impls per Phase 1+2
//! precedent. NO `thiserror` dep. The IPC boundary in `commands.rs` converts to
//! `String` via `.to_string()`; internal call sites stay typed.

use crate::update::manifest::ManifestError;
use crate::update::storage::StorageError;
use crate::update::version::ParseError;

#[derive(Debug)]
pub enum UpdateError {
    Parse(ParseError),
    Manifest(ManifestError),
    Storage(StorageError),
    UpdaterPlugin(tauri_plugin_updater::Error),
    Json(serde_json::Error),
    Io(std::io::Error),
    AppDataPath(String),
    MissingPlatform { key: String },
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::Parse(e) => write!(f, "version parse error: {e}"),
            UpdateError::Manifest(e) => write!(f, "manifest error: {e}"),
            UpdateError::Storage(e) => write!(f, "storage error: {e}"),
            UpdateError::UpdaterPlugin(e) => write!(f, "updater plugin error: {e}"),
            UpdateError::Json(e) => write!(f, "json error: {e}"),
            UpdateError::Io(e) => write!(f, "io error: {e}"),
            UpdateError::AppDataPath(s) => write!(f, "app data path error: {s}"),
            UpdateError::MissingPlatform { key } => write!(f, "no asset for platform {key}"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<ParseError> for UpdateError {
    fn from(e: ParseError) -> Self {
        UpdateError::Parse(e)
    }
}

impl From<ManifestError> for UpdateError {
    fn from(e: ManifestError) -> Self {
        UpdateError::Manifest(e)
    }
}

impl From<StorageError> for UpdateError {
    fn from(e: StorageError) -> Self {
        UpdateError::Storage(e)
    }
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        UpdateError::UpdaterPlugin(e)
    }
}

impl From<serde_json::Error> for UpdateError {
    fn from(e: serde_json::Error) -> Self {
        UpdateError::Json(e)
    }
}

impl From<std::io::Error> for UpdateError {
    fn from(e: std::io::Error) -> Self {
        UpdateError::Io(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_renders_each_variant() {
        let parse = UpdateError::Parse(ParseError::Empty);
        assert!(parse.to_string().contains("version parse error"));

        let mp = UpdateError::MissingPlatform {
            key: "windows-x86_64".into(),
        };
        assert!(mp.to_string().contains("no asset for platform windows-x86_64"));

        let app = UpdateError::AppDataPath("denied".into());
        assert!(app.to_string().contains("denied"));
    }

    #[test]
    fn from_parse_error_wraps_into_update_error() {
        let err: UpdateError = ParseError::Empty.into();
        assert!(matches!(err, UpdateError::Parse(_)));
    }

    #[test]
    fn from_manifest_error_wraps_into_update_error() {
        let err: UpdateError = ManifestError::EmptyPlatforms.into();
        assert!(matches!(err, UpdateError::Manifest(_)));
    }

    #[test]
    fn from_storage_error_wraps_into_update_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "x");
        let err: UpdateError = StorageError::Io(io).into();
        assert!(matches!(err, UpdateError::Storage(_)));
    }

    #[test]
    fn from_io_error_wraps_into_update_error() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "x");
        let err: UpdateError = io.into();
        assert!(matches!(err, UpdateError::Io(_)));
    }

    #[test]
    fn question_mark_propagates_parse_error() {
        fn inner() -> Result<(), UpdateError> {
            let _ = crate::update::version::parse_semver("")?;
            Ok(())
        }
        assert!(matches!(inner(), Err(UpdateError::Parse(_))));
    }
}
