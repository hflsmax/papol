use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::menu::{Menu, PredefinedMenuItem, WINDOW_SUBMENU_ID};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::Manager;

pub mod data;
pub mod sync;

static ACTIVE_SYNCS: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
fn data_query(
    store: tauri::State<'_, data::LocalStore>,
    account_id: i64,
    query_name: String,
    parameters: serde_json::Value,
) -> Result<serde_json::Value, String> {
    store.query(account_id, &query_name, parameters)
}

#[tauri::command]
fn data_mutate(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_id: i64,
    changes: Vec<data::DataChange>,
) -> Result<data::MutationReceipt, String> {
    use tauri::Emitter;

    let tables = changes
        .iter()
        .map(|change| change.table.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let receipt = store.mutate(account_id, changes)?;
    let _ = app.emit(
        "papol://data-changed",
        serde_json::json!({"tables": tables}),
    );
    Ok(receipt)
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
    account_id: i64,
    profile: serde_json::Value,
) -> Result<(), String> {
    store.set_local_account(account_id, profile)
}

#[tauri::command]
fn local_account_remove(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_id: i64,
) -> Result<usize, String> {
    use tauri::Emitter;

    // Document windows keep decoded papers and board state in memory. Close
    // them before deleting the signed-out account's durable replica.
    for (label, window) in app.webview_windows() {
        if label.starts_with("viewer-") || label.starts_with("board-") {
            let _ = window.close();
        }
    }
    let removed = store.remove_account(account_id)?;
    let _ = app.emit(
        "papol://data-changed",
        serde_json::json!({"accountRemoved": account_id}),
    );
    let _ = app.emit(
        "papol://sync-status",
        serde_json::json!({"accountRemoved": account_id}),
    );
    Ok(removed)
}

#[tauri::command]
fn local_recovery_export(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    account_id: i64,
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
    store.export_recovery(account_id, &directory.join(filename))
}

#[tauri::command]
async fn sync_now(
    app: tauri::AppHandle,
    store: tauri::State<'_, data::LocalStore>,
    coordinator: tauri::State<'_, sync::Coordinator>,
    account_id: i64,
    backend_url: String,
    token: String,
) -> Result<sync::SyncResult, String> {
    use tauri::Emitter;

    if ACTIVE_SYNCS.fetch_add(1, Ordering::SeqCst) == 0 {
        let _ = app.emit("papol://sync-status", serde_json::json!({"syncing": true}));
    }
    let result = coordinator
        .synchronize(&store, account_id, &backend_url, &token)
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
            let _ = store.record_sync_error(account_id, error);
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
    window.__PAPOL_FOCUS_LIBRARY_WINDOW__ = () => \
      window.__TAURI_INTERNALS__.invoke('focus_library_window');";

fn document_environment(surface: &str) -> String {
    format!(
        "window.__PAPOL_ENV__ = Object.freeze({{ \
           runtime: 'desktop', surface: '{surface}', documentWindow: true \
         }}); \
         window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
           window.__TAURI_INTERNALS__.invoke('open_document_window', {{ url }}); \
         window.__PAPOL_CLOSE_DOCUMENT_WINDOW__ = () => \
           window.__TAURI_INTERNALS__.invoke('close_document_window'); \
         window.__PAPOL_FOCUS_LIBRARY_WINDOW__ = () => \
           window.__TAURI_INTERNALS__.invoke('focus_library_window');"
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
fn focus_library_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
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

    // A document has one window. Asking for it again brings that window
    // forward; a note URL may also retarget an already-open paper precisely.
    if let Some(window) = app.get_webview_window(&document.label) {
        let _ = window.navigate(url);
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

#[cfg(target_os = "macos")]
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
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

#[cfg(not(target_os = "macos"))]
fn handle_run_event(_app: &tauri::AppHandle, _event: tauri::RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
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
            open_document_window,
            data_query,
            data_mutate,
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
            sync_now
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
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .expect("tauri.conf.json declares the main window");
            let papol_origin = match &config.url {
                tauri::WebviewUrl::External(url) => Some(url_origin(url)),
                // macOS and Linux expose bundled assets through Tauri's
                // custom origin. Windows uses tauri.localhost instead.
                tauri::WebviewUrl::App(_) if cfg!(windows) => Some("http://tauri.localhost".into()),
                tauri::WebviewUrl::App(_) => Some("tauri://localhost".into()),
                _ => None,
            };
            let app_handle = app.handle().clone();
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
    fn labels_contain_only_safe_bounded_characters() {
        let label = label_part("paper / ? # é :_valid-123");
        assert_eq!(label, "paper_valid-123");
        assert!(label_part(&"a".repeat(120)).len() <= 96);
    }
}
