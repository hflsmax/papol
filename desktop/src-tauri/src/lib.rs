use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, PredefinedMenuItem, WINDOW_SUBMENU_ID};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::Manager;

pub mod capture;
pub mod data;
mod diagnostics;
mod limits;
pub mod sync;

static ACTIVE_SYNCS: AtomicUsize = AtomicUsize::new(0);

/// PDFs the system asked Papol to open (Open With, a double-click once Papol
/// is the default viewer, a drop on the Dock icon, or a command-line path).
/// A viewer window may read only the files named here, and only by the hash
/// of what it was shown.
#[derive(Default)]
struct OpenedFiles {
    files: Mutex<HashMap<String, Vec<u8>>>,
    // Set once the app can build windows; files arriving earlier wait.
    origin: Mutex<Option<String>>,
    waiting: Mutex<Vec<PathBuf>>,
    // A reading handed over from a browser waits the same way, and for the
    // same reason: the very first handoff after installing is a cold launch,
    // so the address always arrives before there is a window to show it in.
    waiting_links: Mutex<Vec<tauri::Url>>,
}

/// The permanent Desk is built hidden so a file-association launch can
/// open directly into its document. Once the first event-loop turn ends, an
/// ordinary app launch reveals the Desk; later PDF opens leave its current
/// visibility alone.
#[derive(Default)]
struct WindowLaunch {
    finished: AtomicBool,
    standalone_viewer: AtomicBool,
}

impl WindowLaunch {
    fn note_standalone_viewer(&self) -> bool {
        if self.finished.load(Ordering::SeqCst) {
            return false;
        }
        self.standalone_viewer.store(true, Ordering::SeqCst);
        true
    }

    fn finish(&self) -> Option<bool> {
        if self.finished.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(!self.standalone_viewer.load(Ordering::SeqCst))
        }
    }
}

fn opened_file_url(origin: &str, sha256: &str, path: &Path) -> Option<tauri::Url> {
    let mut url = format!("{origin}/viewer/").parse::<tauri::Url>().ok()?;
    let name = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    url.query_pairs_mut()
        .append_pair("pdf", sha256)
        .append_pair("file", "1")
        .append_pair("name", name);
    Some(url)
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn add_open_timings(url: &mut tauri::Url, opened_at_ms: u128, read_ms: f64, hash_ms: f64) {
    url.query_pairs_mut()
        .append_pair("opened_at_ms", &opened_at_ms.to_string())
        .append_pair("native_read_ms", &format!("{read_ms:.1}"))
        .append_pair("native_hash_ms", &format!("{hash_ms:.1}"));
}

/// Readings handed over from a browser, opened the way an opened file is.
///
/// The queue is the whole point. `RunEvent::Opened` is how macOS delivers a
/// launch *caused by* an address, so on the first handoff after installing
/// this runs before `setup` has built anything to show it in — and an
/// address dropped there is a user who clicked "Open in Papol", watched
/// Papol start, and got the Desk instead of their paper.
#[cfg(target_os = "macos")]
fn open_handed_over_links(app: &tauri::AppHandle, links: Vec<tauri::Url>) {
    if links.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<OpenedFiles>() else {
        return;
    };
    let origin = state.origin.lock().ok().and_then(|origin| origin.clone());
    let Some(origin) = origin else {
        if let Ok(mut waiting) = state.waiting_links.lock() {
            waiting.extend(links);
        }
        return;
    };
    let scheme = handoff_scheme(&app.config().identifier);
    use tauri::Emitter;
    let _ = app.emit(
        "papol://handoff-received",
        serde_json::json!({"count": links.len()}),
    );
    for link in links {
        let Some(target) = deep_link_url(&link, &origin, &scheme) else {
            continue;
        };
        // The user asked for this document, not for the Desk, so a cold
        // launch opens into it — but only once a window has actually been
        // made for it, or the Desk would stay hidden behind nothing.
        if show_document_window(app, &origin, target) {
            app.state::<WindowLaunch>().note_standalone_viewer();
        }
    }
}

fn open_pdf_files(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let Some(state) = app.try_state::<OpenedFiles>() else {
        return;
    };
    let origin = state.origin.lock().ok().and_then(|origin| origin.clone());
    let Some(origin) = origin else {
        if let Ok(mut waiting) = state.waiting.lock() {
            waiting.extend(paths);
        }
        return;
    };
    for path in paths {
        let opened_at_ms = epoch_ms();
        let phase = Instant::now();
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let read_ms = elapsed_ms(phase);
        let phase = Instant::now();
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let hash_ms = elapsed_ms(phase);
        let Some(mut url) = opened_file_url(&origin, &sha256, &path) else {
            continue;
        };
        add_open_timings(&mut url, opened_at_ms, read_ms, hash_ms);
        if let Ok(mut files) = state.files.lock() {
            // Keep the exact bytes whose identity was put in the URL. PDF.js
            // can receive them without a second disk read and SHA-256 pass,
            // and a file edited in place cannot silently change under an
            // already-open viewer.
            files.insert(sha256, bytes);
        }
        show_document_window(app, &origin, url);
    }
}

fn pdf_paths(arguments: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    arguments
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        })
        .collect()
}

#[tauri::command]
fn opened_file_read(
    opened: tauri::State<'_, OpenedFiles>,
    sha256: String,
) -> Result<tauri::ipc::Response, String> {
    let files = opened
        .files
        .lock()
        .map_err(|_| "Opened files lock failed")?;
    let bytes = files
        .get(&sha256)
        .ok_or("Papol was not asked to open this file")?
        .clone();
    drop(files);
    Ok(tauri::ipc::Response::new(bytes))
}

/// HTML file drops deliberately stay enabled for the Desk's import UI.
/// Before sign-in, hand their bytes back to the native shell so WebKit never
/// falls through to its own PDF renderer and the file gets Papol's viewer.
#[tauri::command]
fn opened_file_open(
    app: tauri::AppHandle,
    opened: tauri::State<'_, OpenedFiles>,
    bytes: Vec<u8>,
    name: String,
) -> Result<(), String> {
    let opened_at_ms = epoch_ms();
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Papol’s viewer can only open PDF files.".into());
    }
    let origin = opened
        .origin
        .lock()
        .map_err(|_| "Opened files lock failed")?
        .clone()
        .ok_or("Papol is still starting. Drop the PDF again.")?;
    let phase = Instant::now();
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let hash_ms = elapsed_ms(phase);
    let path = PathBuf::from(name);
    let mut url =
        opened_file_url(&origin, &sha256, &path).ok_or("Papol could not create the viewer URL")?;
    add_open_timings(&mut url, opened_at_ms, 0.0, hash_ms);
    opened
        .files
        .lock()
        .map_err(|_| "Opened files lock failed")?
        .insert(sha256, bytes);
    if show_document_window(&app, &origin, url) {
        Ok(())
    } else {
        Err("Papol could not open its PDF viewer.".into())
    }
}

/// Document windows do not sign in themselves: the Desk window does, and
/// the viewer that asked picks the account up when it is focused again.
#[tauri::command]
fn request_sign_in(app: tauri::AppHandle, register: bool) {
    use tauri::Emitter;

    focus_desk_window(app.clone(), None);
    let _ = app.emit_to(
        "desk",
        "papol://sign-in-requested",
        serde_json::json!({"register": register}),
    );
}

#[cfg(target_os = "macos")]
mod pdf_handler {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    const PDF_CONTENT_TYPE: &str = "com.adobe.pdf";
    const ALL_ROLES: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
        ) -> CFStringRef;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler_bundle_id: CFStringRef,
        ) -> i32;
    }

    pub fn is_default(bundle_identifier: &str) -> bool {
        let content_type = CFString::from_static_string(PDF_CONTENT_TYPE);
        // SAFETY: the argument is a live CFString; the result follows the
        // Create rule and is released by wrap_under_create_rule.
        let handler = unsafe {
            LSCopyDefaultRoleHandlerForContentType(content_type.as_concrete_TypeRef(), ALL_ROLES)
        };
        if handler.is_null() {
            return false;
        }
        let handler = unsafe { CFString::wrap_under_create_rule(handler) };
        handler.to_string().eq_ignore_ascii_case(bundle_identifier)
    }

    pub fn make_default(bundle_identifier: &str) -> Result<(), String> {
        let content_type = CFString::from_static_string(PDF_CONTENT_TYPE);
        let handler = CFString::new(bundle_identifier);
        // SAFETY: both arguments are live CFStrings for the whole call.
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                content_type.as_concrete_TypeRef(),
                ALL_ROLES,
                handler.as_concrete_TypeRef(),
            )
        };
        match status {
            0 => Ok(()),
            // kLSApplicationNotFoundErr: a development build is not an
            // installed application the system knows about.
            -10814 => Err("Install Papol in Applications to make it your PDF viewer.".into()),
            status => Err(format!(
                "macOS did not change the PDF viewer (error {status})."
            )),
        }
    }
}

/// Set when the user answers the default-viewer prompt. Held in memory so
/// every window stops asking for the rest of this launch, and the next launch
/// asks again.
static PDF_VIEWER_PROMPT_DISMISSED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn pdf_viewer_status(app: tauri::AppHandle) -> serde_json::Value {
    let prompt_dismissed = PDF_VIEWER_PROMPT_DISMISSED.load(std::sync::atomic::Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    {
        serde_json::json!({
            "supported": true,
            "is_default": pdf_handler::is_default(&app.config().identifier),
            "prompt_dismissed": prompt_dismissed,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        serde_json::json!({"supported": false, "is_default": false, "prompt_dismissed": prompt_dismissed})
    }
}

#[tauri::command]
fn pdf_viewer_prompt_dismiss() {
    PDF_VIEWER_PROMPT_DISMISSED.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn pdf_viewer_make_default(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        pdf_handler::make_default(&app.config().identifier)?;
        Ok(pdf_viewer_status(app))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Choose Papol as the PDF viewer in your system settings.".into())
    }
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum LocalDataQuery {
    Account,
    Annotations,
    Board,
    BoardGroup,
    Boards,
    Nook,
    Paper,
    PaperByPdf,
    Papers,
    Shelves,
    StorageStatus,
    SyncStatus,
    Tags,
}

impl LocalDataQuery {
    fn as_str(self) -> &'static str {
        match self {
            Self::Account => "account",
            Self::Annotations => "annotations",
            Self::Board => "board",
            Self::BoardGroup => "board_group",
            Self::Boards => "boards",
            Self::Nook => "nook",
            Self::Paper => "paper",
            Self::PaperByPdf => "paper_by_pdf",
            Self::Papers => "papers",
            Self::Shelves => "shelves",
            Self::StorageStatus => "storage_status",
            Self::SyncStatus => "sync_status",
            Self::Tags => "tags",
        }
    }
}

#[tauri::command]
fn data_query(
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    query_name: LocalDataQuery,
    parameters: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut result = store.query(&account_uuid, query_name.as_str(), parameters)?;
    if matches!(query_name, LocalDataQuery::SyncStatus) {
        result["syncing"] = serde_json::json!(ACTIVE_SYNCS.load(Ordering::SeqCst) > 0);
    }
    Ok(result)
}

#[tauri::command]
fn data_mutate(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    changes: Vec<data::DataChange>,
) -> Result<data::MutationReceipt, String> {
    use tauri::Emitter;

    let tables = changes
        .iter()
        .map(|change| change.table.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let receipt = store.mutate(&account_uuid, changes)?;
    let _ = app.emit(
        "papol://data-changed",
        serde_json::json!({"tables": tables}),
    );
    Ok(receipt)
}

#[tauri::command]
fn import_shared_paper(
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    row: serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    store.import_shared_paper(&account_uuid, row)
}

#[tauri::command]
fn blob_import(
    store: tauri::State<'_, data::LocalStore>,
    bytes: Vec<u8>,
    mime_type: Option<String>,
) -> Result<data::BlobRecord, String> {
    store.import_blob(&bytes, mime_type)
}

#[tauri::command]
fn blob_cache(
    store: tauri::State<'_, data::LocalStore>,
    expected_sha256: String,
    bytes: Vec<u8>,
    mime_type: Option<String>,
) -> Result<(), String> {
    store.import_remote_blob(&expected_sha256, &bytes, mime_type)
}

/// A web page's picture for a board card, taken on this Mac (capture.rs).
#[tauri::command]
async fn capture_webpage(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    url: String,
) -> Result<data::BlobRecord, String> {
    capture::capture_into(&app, &store, &url).await
}

#[tauri::command]
fn blob_read(store: tauri::State<'_, data::LocalStore>, sha256: String) -> Result<Vec<u8>, String> {
    store.read_blob(&sha256)
}

#[tauri::command]
async fn blob_ensure(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    coordinator: tauri::State<'_, sync::Coordinator>,
    backend_url: String,
    token: String,
    sha256: String,
    kind: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    // What the file is says where the bucket keeps it; a paper unless said otherwise.
    let kind = match kind.as_deref() {
        Some("board_file") => data::BlobKind::BoardFile,
        _ => data::BlobKind::Paper,
    };
    let progress_app = app.clone();
    let progress_sha256 = sha256.clone();
    let report = move |progress: sync::SyncProgress| {
        // A one-file ensure uses the downloading quarter of the general sync
        // meter. Send a file-relative fraction so its viewer can draw a bar
        // from zero to completion without pretending the other phases ran.
        let fraction = ((progress.fraction - 0.75) * 4.0).clamp(0.0, 1.0);
        let _ = progress_app.emit(
            "papol://blob-progress",
            serde_json::json!({
                "sha256": progress_sha256,
                "fraction": fraction,
                "bytes": progress.bytes,
                "bytes_per_second": progress.bytes_per_second,
            }),
        );
    };
    coordinator
        .ensure_blob(&store, &backend_url, &token, &sha256, kind, &report)
        .await
}

#[tauri::command]
fn local_clear_data(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
) -> Result<usize, String> {
    use tauri::Emitter;

    let removed = store.clear_data()?;
    let _ = app.emit("papol://data-changed", serde_json::json!({"cleared": true}));
    let _ = app.emit("papol://sync-status", serde_json::json!({"cleared": true}));
    Ok(removed)
}

#[tauri::command]
fn blob_discard(store: tauri::State<'_, data::LocalStore>, sha256: String) -> Result<bool, String> {
    store.discard_unreferenced_blob(&sha256)
}

#[tauri::command]
fn local_setting_get(
    store: tauri::State<'_, data::LocalStore>,
    key: String,
) -> Result<Option<String>, String> {
    store.local_setting(&key)
}

#[tauri::command]
fn local_setting_set(
    store: tauri::State<'_, data::LocalStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    store.set_local_setting(&key, &value)
}

#[tauri::command]
fn local_account_set(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    profile: serde_json::Value,
) -> Result<(), String> {
    use tauri::Emitter;

    store.set_local_account(&account_uuid, profile.clone())?;
    let _ = app.emit(
        "papol://account-changed",
        serde_json::json!({"accountUuid": account_uuid, "profile": profile}),
    );
    Ok(())
}

#[tauri::command]
fn local_account_remove(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
) -> Result<usize, String> {
    use tauri::Emitter;

    // Document windows keep decoded papers and board state in memory. Close
    // them before deleting the signed-out account's durable replica.
    for (label, window) in app.webview_windows() {
        if label.starts_with("viewer-") || label.starts_with("board-") {
            let _ = window.close();
        }
    }
    let removed = store.remove_account(&account_uuid)?;
    let _ = app.emit(
        "papol://data-changed",
        serde_json::json!({"accountRemoved": account_uuid}),
    );
    let _ = app.emit(
        "papol://sync-status",
        serde_json::json!({"accountRemoved": account_uuid}),
    );
    Ok(removed)
}

#[tauri::command]
fn local_recovery_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
) -> Result<data::RecoveryExport, String> {
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    let filename = format!(
        "Papol Offline Recovery {} {}.zip",
        chrono::Local::now().format("%Y-%m-%d %H-%M-%S"),
        uuid::Uuid::new_v4().simple(),
    );
    store.export_recovery(&account_uuid, &directory.join(filename))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    account_uuid: String,
    backend_url: String,
    token: String,
    mode: sync::SyncMode,
    retry_blocked: Option<bool>,
}

#[tauri::command]
async fn sync_now(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    coordinator: tauri::State<'_, sync::Coordinator>,
    diagnostic_log: tauri::State<'_, diagnostics::DiagnosticLog>,
    request: SyncRequest,
) -> Result<sync::SyncResult, String> {
    use tauri::Emitter;

    let started = std::time::Instant::now();
    let _ = diagnostic_log.record("info", "sync", "started", None, None);
    if ACTIVE_SYNCS.fetch_add(1, Ordering::SeqCst) == 0 {
        let _ = app.emit("papol://sync-status", serde_json::json!({"syncing": true}));
    }
    let progress_app = app.clone();
    let report = move |progress: sync::SyncProgress| {
        let _ = progress_app.emit("papol://sync-progress", progress);
    };
    let result = coordinator
        .synchronize_with_progress(
            &store,
            &request.account_uuid,
            &request.backend_url,
            &request.token,
            sync::ReconcileOptions {
                retry_blocked: request.retry_blocked.unwrap_or(false),
                mode: request.mode,
            },
            &report,
        )
        .await;
    if ACTIVE_SYNCS.fetch_sub(1, Ordering::SeqCst) == 1 {
        let _ = app.emit("papol://sync-status", serde_json::json!({"syncing": false}));
    }
    match &result {
        Ok(status) => {
            let _ = diagnostic_log.record(
                "info",
                "sync",
                "completed",
                None,
                Some(&serde_json::Map::from_iter([
                    (
                        "duration_ms".into(),
                        serde_json::json!(started.elapsed().as_millis()),
                    ),
                    ("pushed".into(), serde_json::json!(status.pushed)),
                    ("pulled".into(), serde_json::json!(status.pulled)),
                ])),
            );
            let _ = app.emit(
                "papol://data-changed",
                serde_json::json!({"scope": "synchronized-data"}),
            );
            let _ = app.emit("papol://sync-status", status);
        }
        Err(error) => {
            let _ = diagnostic_log.record(
                "error",
                "sync",
                "failed",
                Some(error),
                Some(&serde_json::Map::from_iter([(
                    "duration_ms".into(),
                    serde_json::json!(started.elapsed().as_millis()),
                )])),
            );
            let _ = store.record_sync_error(&request.account_uuid, error);
            let _ = app.emit("papol://sync-status", serde_json::json!({"error": error}));
        }
    }
    result
}

// The build's version rides along, so the windows' own requests say which
// Papol sent them exactly as the synchronizer's User-Agent does.
const DESKTOP_ENVIRONMENT: &str = concat!(
    "window.__PAPOL_ENV__ = Object.freeze({ \
      runtime: 'desktop', surface: 'desk', documentWindow: false, version: '",
    env!("CARGO_PKG_VERSION"),
    "' \
    }); \
    window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
      window.__TAURI_INTERNALS__.invoke('open_document_window', { url }); \
    window.__PAPOL_FOCUS_DESK_WINDOW__ = (paperSha256) => \
      window.__TAURI_INTERNALS__.invoke('focus_desk_window', { paperSha256 });"
);

fn document_environment(surface: &str) -> String {
    format!(
        "window.__PAPOL_ENV__ = Object.freeze({{ \
           runtime: 'desktop', surface: '{surface}', documentWindow: true, version: '{version}' \
         }}); \
         window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
           window.__TAURI_INTERNALS__.invoke('open_document_window', {{ url }}); \
         window.__PAPOL_CLOSE_DOCUMENT_WINDOW__ = () => \
           window.__TAURI_INTERNALS__.invoke('close_document_window'); \
         window.__PAPOL_FOCUS_DESK_WINDOW__ = (paperSha256) => \
           window.__TAURI_INTERNALS__.invoke('focus_desk_window', {{ paperSha256 }});",
        version = env!("CARGO_PKG_VERSION"),
    )
}

/// Offered to document windows only, by `capabilities/documents.json`.
#[tauri::command]
fn close_document_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
fn focus_desk_window(app: tauri::AppHandle, paper_sha256: Option<String>) {
    use tauri::Emitter;

    if let Some(window) = app.get_webview_window("desk") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(paper_sha256) = paper_sha256 {
            let _ = app.emit_to(
                "desk",
                "papol://show-paper-requested",
                serde_json::json!({"paper_sha256": paper_sha256}),
            );
        }
    }
}

#[tauri::command]
fn open_storage_in_finder(app: tauri::AppHandle) -> Result<(), String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(&data_directory)
            .status()
            .map_err(|error| format!("Could not open Finder: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Finder could not open Papol’s storage folder".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = data_directory;
        Err("Opening Papol storage in Finder is available only on macOS".into())
    }
}

#[tauri::command]
fn diagnostic_log(
    log: tauri::State<'_, diagnostics::DiagnosticLog>,
    level: String,
    component: String,
    event: String,
    message: Option<String>,
    fields: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<(), String> {
    log.record(
        &level,
        &component,
        &event,
        message.as_deref(),
        fields.as_ref(),
    )
}

#[tauri::command]
fn diagnostic_recent(
    log: tauri::State<'_, diagnostics::DiagnosticLog>,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    log.recent(limit.unwrap_or(80))
}

#[tauri::command]
fn open_diagnostic_logs(log: tauri::State<'_, diagnostics::DiagnosticLog>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(log.directory())
            .status()
            .map_err(|error| format!("Could not open Finder: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Finder could not open Papol’s diagnostic logs".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = log;
        Err("Opening Papol logs in Finder is available only on macOS".into())
    }
}
struct DocumentWindow {
    label: String,
    route: String,
    entry: &'static str,
    title: &'static str,
    width: f64,
    min_width: f64,
}

fn label_part(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(96)
        .collect()
}

fn url_origin(url: &tauri::Url) -> String {
    let serialized = url.origin().ascii_serialization();
    if serialized != "null" {
        return serialized;
    }
    match url.host_str() {
        Some(host) => format!("{}://{host}", url.scheme()),
        None => serialized,
    }
}

/// The scheme Papol answers to when a browser hands a reading over
/// (USER_STORIES.md US-7.32). It mirrors the web address the user was
/// already at: `papol://host/papol/viewer/?pdf=…`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const HANDOFF_SCHEME: &str = "papol";

/// A scheme is claimed from the whole system, and LaunchServices gives it to
/// one application, not to the one the user had in mind. Every other place
/// a build could tread on the installed Papol is already kept apart by its
/// identifier — its data store, its cookies — and this is the last one that
/// was not: without it, a development build wins the scheme and swallows
/// readings meant for the Papol in /Applications.
///
/// Kept in step with scripts/write-info-plist.mjs, which registers exactly
/// the scheme this returns for the build being bundled.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn handoff_scheme(identifier: &str) -> String {
    match identifier.strip_prefix("com.mc-pony.papol") {
        Some("") | None => HANDOFF_SCHEME.to_string(),
        Some(suffix) => format!("{HANDOFF_SCHEME}{}", suffix.replace('.', "-")),
    }
}

/// Anyone can send one of these — a deep link is an address typed by whatever
/// page cared to send it, not a message from Papol. Only the keys that name a
/// document and a place inside it survive the crossing, so the worst a
/// stranger's link can do is open a document this user already has.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const HANDOFF_QUERY_KEYS: [&str; 8] = ["pdf", "board", "share", "page", "note", "y", "mark", "box"];

/// Rewrites a handed-over address onto the bundled origin that serves it.
///
/// The address names the document by the path the *browser* uses, prefix and
/// all, which is exactly what `document_window` already reads. What it must
/// not keep is the browser's origin: a window built on `https://mc-pony.com`
/// would fetch the hosted site over the network, when the whole point of the
/// application is that its pages are compiled in.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn deep_link_url(url: &tauri::Url, papol_origin: &str, scheme: &str) -> Option<tauri::Url> {
    if url.scheme() != scheme {
        return None;
    }
    let path = url.path();
    if !path.starts_with('/') {
        return None;
    }
    let mut target = format!("{papol_origin}{path}").parse::<tauri::Url>().ok()?;
    let carried: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| HANDOFF_QUERY_KEYS.contains(&key.as_ref()))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if carried.is_empty() {
        target.set_query(None);
    } else {
        let mut pairs = target.query_pairs_mut();
        pairs.clear();
        for (key, value) in &carried {
            pairs.append_pair(key, value);
        }
    }
    Some(target)
}

fn document_window(url: &tauri::Url, papol_origin: &str) -> Option<DocumentWindow> {
    if url_origin(url) != papol_origin {
        return None;
    }
    let parts: Vec<_> = url.path_segments()?.collect();
    if parts.contains(&"viewer") {
        let pdf = url.query_pairs().find(|(key, _)| key == "pdf")?.1;
        let identity = label_part(&pdf);
        if identity.is_empty() {
            return None;
        }
        return Some(DocumentWindow {
            label: format!("viewer-{identity}"),
            route: identity,
            entry: if parts.contains(&"demo") {
                "/demo/viewer/index.html"
            } else {
                "/viewer/index.html"
            },
            title: "Papol Viewer",
            width: 1100.0,
            min_width: 760.0,
        });
    }
    if let Some(index) = parts.iter().position(|part| *part == "boards") {
        let identity = label_part(parts.get(index + 1)?);
        if identity.is_empty() {
            return None;
        }
        let demo = if parts.contains(&"demo") { "demo-" } else { "" };
        return Some(DocumentWindow {
            label: format!("board-{demo}{identity}"),
            route: identity,
            entry: if parts.contains(&"demo") {
                "/demo/boards/index.html"
            } else {
                "/boards/index.html"
            },
            title: "Papol Board",
            width: 1200.0,
            min_width: 800.0,
        });
    }
    None
}

fn bundled_document_url(mut url: tauri::Url, document: &DocumentWindow) -> tauri::Url {
    url.set_path(document.entry);
    if document.entry.contains("/boards/") {
        url.query_pairs_mut()
            .clear()
            .append_pair("board", &document.route);
        if document.entry.starts_with("/demo/") {
            url.query_pairs_mut().append_pair("demo", "1");
        }
    }
    url
}

fn should_navigate_existing_document(document: &DocumentWindow, url: &tauri::Url) -> bool {
    if !document.entry.contains("/viewer/") {
        return true;
    }

    // A plain Read request is only asking for the paper. Its window already
    // has the user's live position and UI state, so navigating it would
    // needlessly reload the PDF. Deep links still need to move the existing
    // viewer to the note, page, excerpt, or clip they identify.
    url.query_pairs()
        .any(|(key, _)| matches!(key.as_ref(), "note" | "page" | "y" | "mark" | "box"))
}

/// The identifier of the application users actually install.
#[cfg(target_os = "macos")]
const RELEASE_IDENTIFIER: &str = "com.mc-pony.papol";

/// Which WebView store this build keeps its cookies and local storage in.
///
/// WKWebView cannot be given a data directory, only a sixteen-byte store
/// identifier, and with no identifier it files everything under the name of
/// the running executable. `tauri dev` runs `papol-desktop` unbundled, so a
/// development run shares one store with every other unbundled build of that
/// name — while its replica, named by the configured identifier, is its own.
/// The two then disagree: a replica created this minute inherits the account
/// a development session left behind days ago, and Papol opens by reporting
/// an error about a user it cannot find.
///
/// The installed application keeps the default store. Its users are signed
/// in there, and moving it would sign every one of them out once to fix
/// something none of them have.
///
/// Available on macOS 14 and later. An older system ignores it and keeps the
/// behaviour it has today.
#[cfg(target_os = "macos")]
fn webview_data_store(identifier: &str) -> Option<[u8; 16]> {
    if identifier == RELEASE_IDENTIFIER {
        return None;
    }
    let digest = Sha256::digest(identifier.as_bytes());
    let mut store = [0_u8; 16];
    store.copy_from_slice(&digest[..16]);
    Some(store)
}

fn show_document_window(app: &tauri::AppHandle, papol_origin: &str, url: tauri::Url) -> bool {
    let Some(document) = document_window(&url, papol_origin) else {
        return false;
    };
    let url = bundled_document_url(url, &document);
    let surface = if document.entry.contains("/boards/") {
        "board"
    } else {
        "viewer"
    };
    let environment = document_environment(surface);

    // A document has one window. A normal Read request merely brings an open
    // viewer forward; a deep link may also retarget it precisely.
    if let Some(window) = app.get_webview_window(&document.label) {
        if should_navigate_existing_document(&document, &url) {
            let _ = window.navigate(url);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return true;
    }

    // Build from the Desk WindowConfig so document windows inherit the same
    // native chrome, including the traffic-light position.
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "desk")
        .cloned()
        .expect("tauri.conf.json declares the Desk window");
    config.label = document.label;
    config.create = true;
    config.url = tauri::WebviewUrl::External(url);
    config.center = false;
    config.x = None;
    config.y = None;
    config.width = document.width;
    config.height = 820.0;
    config.min_width = Some(document.min_width);
    config.min_height = Some(560.0);
    config.title = document.title.into();
    let nested_app = app.clone();
    let nested_origin = papol_origin.to_owned();
    let Ok(builder) = WebviewWindowBuilder::from_config(app, &config) else {
        return false;
    };
    #[allow(unused_mut)]
    let mut builder = builder
        .initialization_script(environment)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_new_window(move |url, _features| {
            if !show_document_window(&nested_app, &nested_origin, url.clone()) {
                open_in_browser(&url);
            }
            NewWindowResponse::Deny
        })
        .on_download(|_webview, _event| true);
    // The same store as the Desk window: a document window reads the
    // user's credential from the storage the Desk wrote it to.
    #[cfg(target_os = "macos")]
    if let Some(store) = webview_data_store(&app.config().identifier) {
        builder = builder.data_store_identifier(store);
    }
    builder.build().is_ok()
}

#[tauri::command]
fn open_document_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<(), String> {
    let source_url = window.url().map_err(|error| error.to_string())?;
    let target_url = url
        .parse::<tauri::Url>()
        .map_err(|error| error.to_string())?;
    let papol_origin = url_origin(&source_url);
    if show_document_window(&app, &papol_origin, target_url) {
        Ok(())
    } else {
        Err("Papol can only open viewer and board URLs in document windows".into())
    }
}

fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if matches!(event, tauri::RunEvent::MainEventsCleared) {
        let launch = app.state::<WindowLaunch>();
        if matches!(launch.finish(), Some(true)) {
            focus_desk_window(app.clone(), None);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let tauri::RunEvent::Opened { urls } = &event {
            // A reading handed over from a browser. The application is
            // already the one place that knows how to show a document, so
            // the address is turned into a bundled one and given to it.
            let scheme = handoff_scheme(&app.config().identifier);
            let handed: Vec<_> = urls
                .iter()
                .filter(|url| url.scheme() == scheme)
                .cloned()
                .collect();
            if !handed.is_empty() {
                open_handed_over_links(app, handed);
                return;
            }
            let paths = pdf_paths(
                urls.iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned()),
            );
            if !paths.is_empty() {
                app.state::<WindowLaunch>().note_standalone_viewer();
            }
            open_pdf_files(app, paths);
            return;
        }
        if matches!(event, tauri::RunEvent::Reopen { .. }) {
            if let Some(window) = app.get_webview_window("desk") {
                if !matches!(window.is_visible(), Ok(true)) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(OpenedFiles::default())
        .manage(WindowLaunch::default())
        .menu(|app| {
            let menu = Menu::default(app)?;
            if let Some(item) = menu.get(WINDOW_SUBMENU_ID) {
                if let Some(window_menu) = item.as_submenu() {
                    window_menu.append(&PredefinedMenuItem::separator(app)?)?;
                    window_menu.append(&PredefinedMenuItem::bring_all_to_front(app, None)?)?;
                }
            }
            Ok(menu)
        })
        .on_window_event(|window, event| {
            if window.label() == "desk" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(hash) = window.label().strip_prefix("viewer-") {
                    if let Some(opened) = window.app_handle().try_state::<OpenedFiles>() {
                        if let Ok(mut files) = opened.files.lock() {
                            files.remove(hash);
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            close_document_window,
            focus_desk_window,
            open_storage_in_finder,
            diagnostic_log,
            diagnostic_recent,
            open_diagnostic_logs,
            open_document_window,
            data_query,
            data_mutate,
            import_shared_paper,
            blob_import,
            blob_cache,
            blob_read,
            blob_ensure,
            capture_webpage,
            local_clear_data,
            blob_discard,
            local_setting_get,
            local_setting_set,
            local_account_set,
            local_account_remove,
            local_recovery_export,
            sync_now,
            opened_file_read,
            opened_file_open,
            request_sign_in,
            pdf_viewer_status,
            pdf_viewer_make_default,
            pdf_viewer_prompt_dismiss
        ])
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_directory)?;
            let diagnostic_log = diagnostics::DiagnosticLog::new(&data_directory);
            let _ = diagnostic_log.record(
                "info",
                "native",
                "app_started",
                None,
                Some(&serde_json::Map::from_iter([
                    ("operation".into(), serde_json::json!("startup")),
                    ("surface".into(), serde_json::json!("desk")),
                    (
                        "version".into(),
                        serde_json::json!(env!("CARGO_PKG_VERSION")),
                    ),
                ])),
            );
            app.manage(diagnostic_log);
            let store =
                data::LocalStore::open(&data_directory.join("papol.sqlite3")).map_err(|error| {
                    let _ = app.state::<diagnostics::DiagnosticLog>().record(
                        "error",
                        "native",
                        "database_startup_failed",
                        Some(&error),
                        Some(&serde_json::Map::from_iter([(
                            "operation".into(),
                            serde_json::json!("open_database"),
                        )])),
                    );
                    std::io::Error::other(error)
                })?;
            let _ = app.state::<diagnostics::DiagnosticLog>().record(
                "info",
                "native",
                "database_ready",
                None,
                Some(&serde_json::Map::from_iter([(
                    "operation".into(),
                    serde_json::json!("schema_applied"),
                )])),
            );
            app.manage(store);
            app.manage(sync::Coordinator::new().map_err(std::io::Error::other)?);
            // The window is declared in tauri.conf.json with `create: false`
            // and built here, because a webview's handlers can only be given
            // to it as it is created.
            let mut config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "desk")
                .cloned()
                .expect("tauri.conf.json declares the Desk window");
            // Keep the Desk off screen through the initial native open-file
            // events. handle_run_event reveals it for an ordinary app launch.
            config.visible = false;
            let papol_origin = match &config.url {
                tauri::WebviewUrl::External(url) => Some(url_origin(url)),
                // macOS and Linux expose bundled assets through Tauri's
                // custom origin. Windows uses tauri.localhost instead.
                tauri::WebviewUrl::App(_) if cfg!(windows) => Some("http://tauri.localhost".into()),
                tauri::WebviewUrl::App(_) => Some("tauri://localhost".into()),
                _ => None,
            };
            let app_handle = app.handle().clone();
            let opened_origin = papol_origin.clone();
            #[allow(unused_mut)]
            let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Publish Papol's runtime contract before application modules
                // execute, without exposing Tauri's entire global API.
                .initialization_script(DESKTOP_ENVIRONMENT)
                // Papers are native document windows: the Papol Desk
                // remains mounted behind them, ready exactly where it was.
                // Other target=_blank links still belong in the browser.
                .on_new_window(move |url, _features| {
                    if let Some(origin) = &papol_origin {
                        if show_document_window(&app_handle, origin, url.clone()) {
                            return NewWindowResponse::Deny;
                        }
                    }
                    open_in_browser(&url);
                    NewWindowResponse::Deny
                })
                // Downloads (a paper's PDF, an account export) are let through.
                // Without a handler the webview refuses them; with one it saves
                // them to Downloads, numbering rather than overwriting.
                .on_download(|_webview, _event| true);
            // A development build keeps its cookies and local storage to
            // itself instead of sharing the executable's default store with
            // every other unbundled build that happens to share its name.
            #[cfg(target_os = "macos")]
            if let Some(store) = webview_data_store(&app.config().identifier) {
                builder = builder.data_store_identifier(store);
            }
            builder.build()?;
            // Files handed over at launch: by the system before the window
            // existed, or as arguments on platforms that open files that way.
            let opened = app.state::<OpenedFiles>();
            let mut files = std::mem::take(&mut *opened.waiting.lock().expect("opened files"));
            let handed = std::mem::take(&mut *opened.waiting_links.lock().expect("opened files"));
            *opened.origin.lock().expect("opened files") = opened_origin;
            files.extend(pdf_paths(std::env::args().skip(1)));
            if !files.is_empty() {
                app.state::<WindowLaunch>().note_standalone_viewer();
            }
            open_pdf_files(app.handle(), files);
            // Addresses that arrived before there was a window to show them
            // in — which is every handoff that started Papol.
            #[cfg(target_os = "macos")]
            open_handed_over_links(app.handle(), handed);
            #[cfg(not(target_os = "macos"))]
            let _ = handed;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Papol");
    app.run(handle_run_event);
}

/// Hands a web or mail link to the system's default handler. Other schemes
/// are ignored: a page must not be able to launch arbitrary URL handlers.
fn open_in_browser(url: &tauri::Url) {
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return;
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    let _ = command.arg(url.as_str()).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every query the IPC offers. A variant left out of this list is one
    /// these tests cannot vouch for, so add to it when you add one.
    const EVERY_QUERY: &[LocalDataQuery] = &[
        LocalDataQuery::Account,
        LocalDataQuery::Annotations,
        LocalDataQuery::Board,
        LocalDataQuery::BoardGroup,
        LocalDataQuery::Boards,
        LocalDataQuery::Nook,
        LocalDataQuery::Paper,
        LocalDataQuery::PaperByPdf,
        LocalDataQuery::Papers,
        LocalDataQuery::Shelves,
        LocalDataQuery::StorageStatus,
        LocalDataQuery::SyncStatus,
        LocalDataQuery::Tags,
    ];

    #[test]
    fn every_query_the_ipc_offers_is_one_the_store_answers() {
        // The two lists drifted apart once already, in the quietest way
        // available: the command boundary refused a name the store was
        // waiting to answer, and nothing failed to compile.
        let directory = tempfile::tempdir().unwrap();
        let store = data::LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        for query in EVERY_QUERY {
            if let Err(message) = store.query("nobody", query.as_str(), serde_json::json!({})) {
                assert!(
                    !message.starts_with("Unknown local query"),
                    "the IPC offers `{}` and the store does not answer it",
                    query.as_str(),
                );
            }
        }
    }

    #[test]
    fn the_unified_annotations_query_is_accepted_by_name() {
        // What the frontend actually sends. It was refused here while notes,
        // ink and clips still had three names of their own, which took every
        // mark on the desktop with it.
        let asked: LocalDataQuery = serde_json::from_str("\"annotations\"")
            .expect("the IPC must accept the name the frontend asks by");
        assert_eq!(asked.as_str(), "annotations");
    }

    #[test]
    fn local_data_queries_are_a_closed_ipc_contract() {
        let query: LocalDataQuery = serde_json::from_str("\"paper_by_pdf\"").unwrap();
        assert_eq!(query.as_str(), "paper_by_pdf");
        assert!(serde_json::from_str::<LocalDataQuery>("\"arbitrary_sql\"").is_err());
    }

    fn parse(url: &str) -> tauri::Url {
        url.parse().expect("test URL should parse")
    }

    #[test]
    fn recognizes_viewer_urls_on_the_papol_origin() {
        let window = document_window(
            &parse("https://mc-pony.com/papol/viewer/?pdf=paper-123#page=4"),
            "https://mc-pony.com",
        )
        .expect("viewer URL should create a document window");

        assert_eq!(window.label, "viewer-paper-123");
        assert_eq!(window.title, "Papol Viewer");
        assert_eq!(window.width, 1100.0);
        assert_eq!(window.min_width, 760.0);
        assert_eq!(window.entry, "/viewer/index.html");
    }

    #[test]
    fn recognizes_regular_and_demo_board_urls() {
        let regular = document_window(
            &parse("https://mc-pony.com/papol/boards/board_123"),
            "https://mc-pony.com",
        )
        .expect("board URL should create a document window");
        let demo = document_window(
            &parse("https://mc-pony.com/papol/demo/boards/board-456"),
            "https://mc-pony.com",
        )
        .expect("demo board URL should create a document window");

        assert_eq!(regular.label, "board-board_123");
        assert_eq!(demo.label, "board-demo-board-456");
        assert_eq!(regular.entry, "/boards/index.html");
        assert_eq!(demo.entry, "/demo/boards/index.html");
    }

    #[test]
    fn maps_document_routes_to_bundled_entry_points() {
        let original = parse("tauri://localhost/boards/board-123");
        let document = document_window(&original, "tauri://localhost")
            .expect("local board URL should be recognized");
        let bundled = bundled_document_url(original, &document);

        assert_eq!(bundled.path(), "/boards/index.html");
        assert_eq!(bundled.query(), Some("board=board-123"));

        let original = parse("tauri://localhost/viewer/?pdf=paper-123&page=4#note");
        let document = document_window(&original, "tauri://localhost")
            .expect("local viewer URL should be recognized");
        let bundled = bundled_document_url(original, &document);
        assert_eq!(bundled.path(), "/viewer/index.html");
        assert_eq!(bundled.query(), Some("pdf=paper-123&page=4"));
        assert_eq!(bundled.fragment(), Some("note"));
    }

    #[test]
    fn plain_read_focuses_an_existing_viewer_without_reloading_it() {
        let plain = parse("tauri://localhost/viewer/?pdf=paper-123");
        let document =
            document_window(&plain, "tauri://localhost").expect("viewer URL should be recognized");

        assert!(!should_navigate_existing_document(&document, &plain));

        let opened_file = parse("tauri://localhost/viewer/?pdf=paper-123&file=1&name=Local+paper");
        assert!(!should_navigate_existing_document(&document, &opened_file));
    }

    #[test]
    fn deep_links_still_retarget_an_existing_viewer() {
        let document = document_window(
            &parse("tauri://localhost/viewer/?pdf=paper-123"),
            "tauri://localhost",
        )
        .expect("viewer URL should be recognized");

        for target in [
            "note=note-456",
            "page=4&y=0.25",
            "page=4&mark=selection",
            "page=4&box=clip",
        ] {
            let url = parse(&format!("tauri://localhost/viewer/?pdf=paper-123&{target}"));
            assert!(should_navigate_existing_document(&document, &url));
        }
    }

    #[test]
    fn rejects_external_and_malformed_document_urls() {
        assert!(document_window(
            &parse("https://example.com/papol/viewer/?pdf=paper-123"),
            "https://mc-pony.com"
        )
        .is_none());
        assert!(document_window(
            &parse("https://mc-pony.com/papol/viewer/"),
            "https://mc-pony.com"
        )
        .is_none());
        assert!(document_window(
            &parse("https://mc-pony.com/papol/boards/"),
            "https://mc-pony.com"
        )
        .is_none());
    }

    #[test]
    fn opened_files_get_their_own_viewer_window() {
        let sha256 = "a".repeat(64);
        let url = opened_file_url(
            "tauri://localhost",
            &sha256,
            Path::new("/Users/user/Downloads/Attention & more.pdf"),
        )
        .expect("opened file URL");
        let document =
            document_window(&url, "tauri://localhost").expect("opened file opens in a viewer");
        assert_eq!(document.label, format!("viewer-{sha256}"));
        let bundled = bundled_document_url(url, &document);
        assert_eq!(bundled.path(), "/viewer/index.html");
        assert_eq!(
            bundled.query(),
            Some(format!("pdf={sha256}&file=1&name=Attention+%26+more").as_str())
        );
    }

    #[test]
    fn only_pdf_paths_are_opened() {
        let arguments = [
            "-psn_0_12345".to_string(),
            "/Users/user/Downloads/paper.PDF".to_string(),
            "/Users/user/Downloads/notes.txt".to_string(),
        ];
        assert_eq!(
            pdf_paths(arguments),
            vec![PathBuf::from("/Users/user/Downloads/paper.PDF")]
        );
    }

    #[test]
    fn ordinary_launch_opens_the_desk_once() {
        let launch = WindowLaunch::default();

        assert_eq!(launch.finish(), Some(true));
        assert_eq!(launch.finish(), None);
    }

    #[test]
    fn standalone_viewer_launch_keeps_the_desk_hidden() {
        let launch = WindowLaunch::default();

        assert!(launch.note_standalone_viewer());
        assert_eq!(launch.finish(), Some(false));
        assert!(!launch.note_standalone_viewer());
    }

    #[test]
    fn labels_contain_only_safe_bounded_characters() {
        let label = label_part("paper / ? # é :_valid-123");
        assert_eq!(label, "paper_valid-123");
        assert!(label_part(&"a".repeat(120)).len() <= 96);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_installed_application_keeps_the_store_its_users_are_signed_in_to() {
        // Moving it would sign every user out once, to fix something none
        // of them have.
        assert_eq!(webview_data_store(RELEASE_IDENTIFIER), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn every_other_build_keeps_its_cookies_and_storage_to_itself() {
        let development = webview_data_store("com.mc-pony.papol.dev").expect("a store of its own");
        let elsewhere =
            webview_data_store("com.mc-pony.papol.staging").expect("a store of its own");
        assert_ne!(development, elsewhere);
        // Stable between runs, or a development build would meet an empty
        // nook every time it started.
        assert_eq!(
            Some(development),
            webview_data_store("com.mc-pony.papol.dev"),
        );
    }
    #[test]
    fn a_handed_over_address_becomes_the_bundled_page_that_serves_it() {
        // The browser's origin must not survive: a window built on
        // mc-pony.com would fetch the hosted site, when the application's
        // pages are compiled in.
        let handed = parse("papol://mc-pony.com/papol/viewer/?pdf=paper-123&page=4");
        let target =
            deep_link_url(&handed, "tauri://localhost", "papol").expect("a bundled address");
        assert_eq!(url_origin(&target), "tauri://localhost");

        let document = document_window(&target, "tauri://localhost").expect("a viewer to open");
        let bundled = bundled_document_url(target, &document);
        assert_eq!(bundled.path(), "/viewer/index.html");
        assert_eq!(bundled.query(), Some("pdf=paper-123&page=4"));
        assert_eq!(document.label, "viewer-paper-123");
    }

    #[test]
    fn a_handed_over_board_opens_the_board_it_names() {
        let handed = parse("papol://mc-pony.com/papol/boards/board_123");
        let target =
            deep_link_url(&handed, "tauri://localhost", "papol").expect("a bundled address");
        let document = document_window(&target, "tauri://localhost").expect("a board to open");
        assert_eq!(document.label, "board-board_123");
        assert_eq!(
            bundled_document_url(target, &document).query(),
            Some("board=board_123"),
        );
    }

    #[test]
    fn a_development_address_is_handed_over_the_same_way() {
        let handed = parse("papol://127.0.0.1:5173/viewer/?pdf=paper-123");
        let target =
            deep_link_url(&handed, "tauri://localhost", "papol").expect("a bundled address");
        assert_eq!(target.path(), "/viewer/");
        assert_eq!(target.query(), Some("pdf=paper-123"));
    }

    #[test]
    fn only_the_keys_that_name_a_document_and_a_place_cross_over() {
        // Anyone at all can send one of these, so the address is not a
        // message from Papol and is not treated as one.
        let handed = parse(
            "papol://mc-pony.com/papol/viewer/?pdf=paper-123&token=secret&next=/admin&page=2",
        );
        let target =
            deep_link_url(&handed, "tauri://localhost", "papol").expect("a bundled address");
        let query = target.query().unwrap_or_default();
        assert!(query.contains("pdf=paper-123"));
        assert!(query.contains("page=2"));
        assert!(!query.contains("token"));
        assert!(!query.contains("next"));
    }

    #[test]
    fn a_handed_over_address_that_names_nothing_opens_nothing() {
        let handed = parse("papol://mc-pony.com/papol/");
        let target =
            deep_link_url(&handed, "tauri://localhost", "papol").expect("a bundled address");
        assert_eq!(target.query(), None);
        assert!(document_window(&target, "tauri://localhost").is_none());

        let bare = parse("papol://mc-pony.com/papol/viewer/");
        let target = deep_link_url(&bare, "tauri://localhost", "papol").expect("a bundled address");
        assert!(document_window(&target, "tauri://localhost").is_none());
    }

    #[test]
    fn only_papols_own_scheme_is_answered() {
        for address in [
            "https://mc-pony.com/papol/viewer/?pdf=paper-123",
            "file:///Users/someone/paper.pdf",
            "papolx://mc-pony.com/papol/viewer/?pdf=paper-123",
        ] {
            assert!(
                deep_link_url(&parse(address), "tauri://localhost", "papol").is_none(),
                "{address} is not Papol's scheme",
            );
        }
    }

    #[test]
    fn a_handed_over_reading_retargets_the_window_already_open() {
        // The same rule a viewer opened any other way follows: a plain read
        // brings the window forward, a named place moves it.
        let plain = deep_link_url(
            &parse("papol://mc-pony.com/papol/viewer/?pdf=paper-123"),
            "tauri://localhost",
            "papol",
        )
        .expect("a bundled address");
        let document = document_window(&plain, "tauri://localhost").expect("a viewer");
        assert!(!should_navigate_existing_document(&document, &plain));

        let placed = deep_link_url(
            &parse("papol://mc-pony.com/papol/viewer/?pdf=paper-123&note=n-7"),
            "tauri://localhost",
            "papol",
        )
        .expect("a bundled address");
        assert!(should_navigate_existing_document(&document, &placed));
    }

    #[test]
    fn a_development_build_does_not_answer_the_installed_papols_scheme() {
        // LaunchServices hands a scheme to one application. If a development
        // build claimed `papol`, it could be the one a user's browser
        // reaches, and their paper would open in a build they forgot they
        // had — or in nothing at all, if it is not running.
        assert_eq!(handoff_scheme("com.mc-pony.papol"), "papol");
        assert_eq!(handoff_scheme("com.mc-pony.papol.dev"), "papol-dev");
        assert_ne!(
            handoff_scheme("com.mc-pony.papol"),
            handoff_scheme("com.mc-pony.papol.dev"),
        );
    }

    #[test]
    fn a_build_answers_only_the_scheme_that_is_its_own() {
        let handed = parse("papol://mc-pony.com/papol/viewer/?pdf=paper-123");
        assert!(deep_link_url(&handed, "tauri://localhost", "papol").is_some());
        assert!(deep_link_url(&handed, "tauri://localhost", "papol-dev").is_none());

        let handed_dev = parse("papol-dev://mc-pony.com/papol/viewer/?pdf=paper-123");
        assert!(deep_link_url(&handed_dev, "tauri://localhost", "papol-dev").is_some());
        assert!(deep_link_url(&handed_dev, "tauri://localhost", "papol").is_none());
    }

    #[test]
    fn a_reading_handed_over_before_there_is_a_window_waits_instead_of_vanishing() {
        // The first handoff after installing is a cold launch: macOS delivers
        // the address to start the application, so it arrives before `setup`
        // has set an origin. Dropping it there is the user watching Papol
        // open on the Desk instead of the paper they asked for.
        let opened = OpenedFiles::default();
        assert!(opened.origin.lock().expect("origin").is_none());

        let handed = parse("papol://mc-pony.com/papol/viewer/?pdf=paper-123&page=14");
        opened
            .waiting_links
            .lock()
            .expect("waiting links")
            .push(handed);

        // What `setup` then drains, once an origin exists.
        let waiting = std::mem::take(&mut *opened.waiting_links.lock().expect("waiting links"));
        assert_eq!(waiting.len(), 1, "the address was kept, not dropped");

        let target =
            deep_link_url(&waiting[0], "tauri://localhost", "papol").expect("a bundled address");
        let document = document_window(&target, "tauri://localhost").expect("a viewer to open");
        assert_eq!(
            bundled_document_url(target, &document).query(),
            Some("pdf=paper-123&page=14"),
            "the place survives the wait, not just the document",
        );
    }

    #[test]
    fn the_keys_carried_across_are_the_ones_the_viewer_reads() {
        // Kept in step with shared/macHandoff.js: a key the browser sends and
        // the application drops is a handoff that silently loses the place.
        for key in ["pdf", "board", "share", "page", "note", "y", "mark", "box"] {
            assert!(HANDOFF_QUERY_KEYS.contains(&key), "{key} should cross over");
        }
    }
}
