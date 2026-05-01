pub mod checker;
pub mod dispatcher;
pub mod manifest;
pub mod storage;
pub mod version;

pub use checker::{evaluate_update, is_version_skipped, should_check_now, UpdateDecision};
pub use dispatcher::{
    UpdateAvailablePayload, UpdateDownloadProgressPayload, UpdateInstalledPayload,
};
pub use storage::{
    load, save, with_check_completed, with_dismissed_now, with_skipped_version,
    StorageError, UpdateState,
};
