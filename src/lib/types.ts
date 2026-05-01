/**
 * Mirror of `src-tauri/src/update/storage.rs::UpdateState`.
 * Wire format is snake_case (#[derive(Serialize)] without rename_all).
 */
export interface UpdateState {
  last_check_unix: number;
  last_dismissed_unix: number;
  skipped_versions: string[];
}
