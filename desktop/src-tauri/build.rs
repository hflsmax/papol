fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_document_window",
            "close_document_window",
            "focus_library_window",
            "data_query",
            "data_mutate",
            "blob_import",
            "blob_read",
            "blob_ensure",
            "local_clear_data",
            "blob_discard",
            "local_setting_get",
            "local_setting_set",
            "local_account_set",
            "local_account_remove",
            "local_recovery_export",
            "sync_now",
        ]),
    ))
    .expect("failed to prepare the Papol desktop build")
}
