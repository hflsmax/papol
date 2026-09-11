use tauri::menu::{Menu, PredefinedMenuItem, WINDOW_SUBMENU_ID};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::Manager;

const DESKTOP_MARKER: &str = "window.__PAPOL_DESKTOP__ = true; \
    window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
      window.__TAURI_INTERNALS__.invoke('open_document_window', { url });";
const DOCUMENT_MARKER: &str = "window.__PAPOL_DESKTOP__ = true; \
    window.__PAPOL_DOCUMENT_WINDOW__ = true; \
    window.__PAPOL_OPEN_DOCUMENT_WINDOW__ = (url) => \
      window.__TAURI_INTERNALS__.invoke('open_document_window', { url }); \
    window.__PAPOL_CLOSE_DOCUMENT_WINDOW__ = () => \
      window.__TAURI_INTERNALS__.invoke('close_document_window');";

#[tauri::command]
fn close_document_window(window: tauri::WebviewWindow) {
    // Hosted content may invoke registered commands, so keep this command
    // incapable of closing Papol's permanent library window.
    if window.label().starts_with("viewer-") || window.label().starts_with("board-") {
        let _ = window.close();
    }
}
const DESKTOP_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) PapolDesktop/0.1";

struct DocumentWindow {
    label: String,
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

fn document_window(url: &tauri::Url, papol_origin: &str) -> Option<DocumentWindow> {
    if url.origin().ascii_serialization() != papol_origin {
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
            title: "Papol Board",
            width: 1200.0,
            min_width: 800.0,
        });
    }
    None
}

fn show_document_window(app: &tauri::AppHandle, papol_origin: &str, url: tauri::Url) -> bool {
    let Some(document) = document_window(&url, papol_origin) else {
        return false;
    };

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
    config.user_agent = Some(DESKTOP_USER_AGENT.into());
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
        .initialization_script(DOCUMENT_MARKER)
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
    let papol_origin = source_url.origin().ascii_serialization();
    if show_document_window(&app, &papol_origin, target_url) {
        Ok(())
    } else {
        Err("Papol can only open viewer and board URLs in document windows".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![
            close_document_window,
            open_document_window
        ])
        .setup(|app| {
            // The window is declared in tauri.conf.json with `create: false`
            // and built here, because a webview's handlers can only be given
            // to it as it is created.
            #[allow(unused_mut)]
            let mut config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .expect("tauri.conf.json declares the main window");
            // A debug build can be pointed at another Papol, such as
            // `./deploy.sh dev` on localhost (`npm run dev:local`). A release
            // build always opens the hosted site.
            #[cfg(debug_assertions)]
            if let Ok(url) = std::env::var("PAPOL_URL") {
                config.url = tauri::WebviewUrl::External(url.parse()?);
            }
            let papol_origin = match &config.url {
                tauri::WebviewUrl::External(url) => Some(url.origin().ascii_serialization()),
                _ => None,
            };
            let app_handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Tauri v2 does not expose its JavaScript globals unless the
                // global API is enabled. Papol needs only to know that its
                // page is in this shell, so mark that explicitly before any
                // page script runs instead of exposing the whole API.
                .initialization_script(DESKTOP_MARKER)
                // Remote WebKit pages do not consistently run initialization
                // scripts before their module graph. The user agent is
                // available synchronously on every navigation, so it is the
                // durable shell marker; keep a WebKit-shaped value for sites
                // and libraries that make ordinary browser distinctions.
                .user_agent(DESKTOP_USER_AGENT)
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
        .run(tauri::generate_context!())
        .expect("error while running Papol");
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
