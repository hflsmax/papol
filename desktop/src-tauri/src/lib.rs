use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, PredefinedMenuItem, WINDOW_SUBMENU_ID};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::Manager;

pub mod data;
mod limits;
pub mod sync;

static ACTIVE_SYNCS: AtomicUsize = AtomicUsize::new(0);

/// PDFs the system asked Papol to open (Open With, a double-click once Papol
/// is the default viewer, a drop on the Dock icon, or a command-line path).
/// A viewer window may read only the files named here, and only by the hash
/// of what it was shown.
#[derive(Default)]
struct OpenedFiles {
    files: Mutex<HashMap<String, OpenedFile>>,
    // Set once the app can build windows; files arriving earlier wait.
    origin: Mutex<Option<String>>,
    waiting: Mutex<Vec<PathBuf>>,
}

/// The permanent library is built hidden so a file-association launch can
/// open directly into its document. Once the first event-loop turn ends, an
/// ordinary app launch reveals the library; later PDF opens leave its current
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

enum OpenedFile {
    Path(PathBuf),
    Bytes(Vec<u8>),
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
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        drop(bytes);
        let Some(url) = opened_file_url(&origin, &sha256, &path) else {
            continue;
        };
        if let Ok(mut files) = state.files.lock() {
            files.insert(sha256, OpenedFile::Path(path));
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
                && path.is_file()
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
    let bytes = match files
        .get(&sha256)
        .ok_or("Papol was not asked to open this file")?
    {
        OpenedFile::Path(path) => {
            std::fs::read(path).map_err(|_| "The file can no longer be read")?
        }
        OpenedFile::Bytes(bytes) => bytes.clone(),
    };
    drop(files);
    if format!("{:x}", Sha256::digest(&bytes)) != sha256 {
        return Err("The file has changed since it was opened. Open it again.".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// HTML file drops deliberately stay enabled for the library's import UI.
/// Before sign-in, hand their bytes back to the native shell so WebKit never
/// falls through to its own PDF renderer and the file gets Papol's viewer.
#[tauri::command]
fn opened_file_open(
    app: tauri::AppHandle,
    opened: tauri::State<'_, OpenedFiles>,
    bytes: Vec<u8>,
    name: String,
) -> Result<(), String> {
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Papol’s viewer can only open PDF files.".into());
    }
    let origin = opened
        .origin
        .lock()
        .map_err(|_| "Opened files lock failed")?
        .clone()
        .ok_or("Papol is still starting. Drop the PDF again.")?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let path = PathBuf::from(name);
    let url =
        opened_file_url(&origin, &sha256, &path).ok_or("Papol could not create the viewer URL")?;
    opened
        .files
        .lock()
        .map_err(|_| "Opened files lock failed")?
        .insert(sha256, OpenedFile::Bytes(bytes));
    if show_document_window(&app, &origin, url) {
        Ok(())
    } else {
        Err("Papol could not open its PDF viewer.".into())
    }
}

/// Document windows do not sign in themselves: the library window does, and
/// the viewer that asked picks the account up when it is focused again.
#[tauri::command]
fn request_sign_in(app: tauri::AppHandle, register: Option<bool>) {
    use tauri::Emitter;

    focus_library_window(app.clone(), None);
    let _ = app.emit_to(
        "main",
        "papol://sign-in-requested",
        serde_json::json!({"register": register.unwrap_or(false)}),
    );
}

#[tauri::command]
fn local_annotations_list(
    store: tauri::State<'_, data::LocalStore>,
    sha256: String,
) -> Result<Vec<serde_json::Value>, String> {
    store.local_annotations(&sha256)
}

#[tauri::command]
fn local_annotation_put(
    store: tauri::State<'_, data::LocalStore>,
    sha256: String,
    kind: String,
    uuid: String,
    row: serde_json::Value,
) -> Result<serde_json::Value, String> {
    store.put_local_annotation(&sha256, &kind, &uuid, row)
}

#[tauri::command]
fn local_annotation_delete(
    store: tauri::State<'_, data::LocalStore>,
    uuid: String,
) -> Result<(), String> {
    store.delete_local_annotation(&uuid)
}

#[tauri::command]
fn local_annotations_clear(
    store: tauri::State<'_, data::LocalStore>,
    sha256: String,
) -> Result<usize, String> {
    store.clear_local_annotations(&sha256)
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

#[tauri::command]
fn pdf_viewer_status(app: tauri::AppHandle) -> serde_json::Value {
    #[cfg(target_os = "macos")]
    {
        serde_json::json!({
            "supported": true,
            "is_default": pdf_handler::is_default(&app.config().identifier),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        serde_json::json!({"supported": false, "is_default": false})
    }
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
    Board,
    BoardGroup,
    Boards,
    Clips,
    Comments,
    Copies,
    CopyTags,
    Ink,
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
            Self::Board => "board",
            Self::BoardGroup => "board_group",
            Self::Boards => "boards",
            Self::Clips => "clips",
            Self::Comments => "comments",
            Self::Copies => "copies",
            Self::CopyTags => "copy_tags",
            Self::Ink => "ink",
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
    store.query(&account_uuid, query_name.as_str(), parameters)
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
fn shared_paper_cache(
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    rows: Vec<serde_json::Map<String, serde_json::Value>>,
) -> Result<usize, String> {
    store.cache_shared_paper(&account_uuid, rows)
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
fn blob_read(store: tauri::State<'_, data::LocalStore>, sha256: String) -> Result<Vec<u8>, String> {
    store.read_blob(&sha256)
}

#[tauri::command]
async fn blob_ensure(
    store: tauri::State<'_, data::LocalStore>,
    coordinator: tauri::State<'_, sync::Coordinator>,
    backend_url: String,
    token: String,
    sha256: String,
) -> Result<(), String> {
    coordinator
        .ensure_blob(&store, &backend_url, &token, &sha256)
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
    store: tauri::State<'_, data::LocalStore>,
    account_uuid: String,
    profile: serde_json::Value,
) -> Result<(), String> {
    store.set_local_account(&account_uuid, profile)
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

#[tauri::command]
async fn sync_now(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    coordinator: tauri::State<'_, sync::Coordinator>,
    account_uuid: String,
    backend_url: String,
    token: String,
) -> Result<sync::SyncResult, String> {
    use tauri::Emitter;

    if ACTIVE_SYNCS.fetch_add(1, Ordering::SeqCst) == 0 {
        let _ = app.emit("papol://sync-status", serde_json::json!({"syncing": true}));
    }
    let progress_app = app.clone();
    let report = move |progress: sync::SyncProgress| {
        let _ = progress_app.emit("papol://sync-progress", progress);
    };
    let result = coordinator
        .synchronize_with_progress(&store, &account_uuid, &backend_url, &token, &report)
        .await;
    if ACTIVE_SYNCS.fetch_sub(1, Ordering::SeqCst) == 1 {
        let _ = app.emit("papol://sync-status", serde_json::json!({"syncing": false}));
    }
    match &result {
        Ok(status) => {
            let _ = app.emit(
                "papol://data-changed",
                serde_json::json!({"scope": "synchronized-data"}),
            );
            let _ = app.emit("papol://sync-status", status);
        }
        Err(error) => {
            let _ = store.record_sync_error(&account_uuid, error);
            let _ = app.emit("papol://sync-status", serde_json::json!({"error": error}));
        }
    }
    result
}

const DESKTOP_ENVIRONMENT: &str = "window.__PAPOL_ENV__ = Object.freeze({ \
      runtime: 'desktop', surface: 'main', documentWindow: false \
    }); \
    window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
      window.__TAURI_INTERNALS__.invoke('open_document_window', { url }); \
    window.__PAPOL_FOCUS_LIBRARY_WINDOW__ = (paperUuid) => \
      window.__TAURI_INTERNALS__.invoke('focus_library_window', { paperUuid });";

fn document_environment(surface: &str) -> String {
    format!(
        "window.__PAPOL_ENV__ = Object.freeze({{ \
           runtime: 'desktop', surface: '{surface}', documentWindow: true \
         }}); \
         window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
           window.__TAURI_INTERNALS__.invoke('open_document_window', {{ url }}); \
         window.__PAPOL_CLOSE_DOCUMENT_WINDOW__ = () => \
           window.__TAURI_INTERNALS__.invoke('close_document_window'); \
         window.__PAPOL_FOCUS_LIBRARY_WINDOW__ = (paperUuid) => \
           window.__TAURI_INTERNALS__.invoke('focus_library_window', {{ paperUuid }});"
    )
}

#[tauri::command]
fn close_document_window(window: tauri::WebviewWindow) {
    // Capabilities expose this command only to document windows; retain the
    // label check as defense in depth around the permanent library window.
    if window.label().starts_with("viewer-") || window.label().starts_with("board-") {
        let _ = window.close();
    }
}

#[tauri::command]
fn focus_library_window(app: tauri::AppHandle, paper_uuid: Option<String>) {
    use tauri::Emitter;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(paper_uuid) = paper_uuid {
            let _ = app.emit_to(
                "main",
                "papol://show-paper-requested",
                serde_json::json!({"paper_uuid": paper_uuid}),
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
    // has the reader's live position and UI state, so navigating it would
    // needlessly reload the PDF. Deep links still need to move the existing
    // viewer to the note, page, excerpt, or clip they identify.
    url.query_pairs()
        .any(|(key, _)| matches!(key.as_ref(), "note" | "page" | "y" | "mark" | "box"))
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

    // Build from the main WindowConfig so document windows inherit the same
    // native chrome, including the traffic-light position.
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("tauri.conf.json declares the main window");
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
    builder
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
        .on_download(|_webview, _event| true)
        .build()
        .is_ok()
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
            focus_library_window(app.clone(), None);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let tauri::RunEvent::Opened { urls } = &event {
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
            if let Some(window) = app.get_webview_window("main") {
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
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            close_document_window,
            focus_library_window,
            open_storage_in_finder,
            open_document_window,
            data_query,
            data_mutate,
            shared_paper_cache,
            blob_import,
            blob_read,
            blob_ensure,
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
            local_annotations_list,
            local_annotation_put,
            local_annotation_delete,
            local_annotations_clear,
            pdf_viewer_status,
            pdf_viewer_make_default
        ])
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_directory)?;
            let store = data::LocalStore::open(&data_directory.join("papol.sqlite3"))
                .map_err(std::io::Error::other)?;
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
                .find(|window| window.label == "main")
                .cloned()
                .expect("tauri.conf.json declares the main window");
            // Keep the library off screen through the initial native open-file
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
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Publish Papol's runtime contract before application modules
                // execute, without exposing Tauri's entire global API.
                .initialization_script(DESKTOP_ENVIRONMENT)
                // Papers are native document windows: the Papol library
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
                .on_download(|_webview, _event| true)
                .build()?;
            // Files handed over at launch: by the system before the window
            // existed, or as arguments on platforms that open files that way.
            let opened = app.state::<OpenedFiles>();
            let mut files = std::mem::take(&mut *opened.waiting.lock().expect("opened files"));
            *opened.origin.lock().expect("opened files") = opened_origin;
            files.extend(pdf_paths(std::env::args().skip(1)));
            if !files.is_empty() {
                app.state::<WindowLaunch>().note_standalone_viewer();
            }
            open_pdf_files(app.handle(), files);
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
            Path::new("/Users/reader/Downloads/Attention & more.pdf"),
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
    fn only_existing_pdf_paths_are_opened() {
        let directory = tempfile::tempdir().unwrap();
        let pdf = directory.path().join("paper.PDF");
        std::fs::write(&pdf, b"%PDF-1.7").unwrap();
        let text = directory.path().join("notes.txt");
        std::fs::write(&text, b"notes").unwrap();
        let arguments = [
            "-psn_0_12345".to_string(),
            pdf.to_string_lossy().into_owned(),
            text.to_string_lossy().into_owned(),
            directory
                .path()
                .join("gone.pdf")
                .to_string_lossy()
                .into_owned(),
        ];
        assert_eq!(pdf_paths(arguments), vec![pdf]);
    }

    #[test]
    fn ordinary_launch_opens_the_library_once() {
        let launch = WindowLaunch::default();

        assert_eq!(launch.finish(), Some(true));
        assert_eq!(launch.finish(), None);
    }

    #[test]
    fn standalone_viewer_launch_keeps_the_library_hidden() {
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
}
