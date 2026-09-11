use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // A link that asks for a new tab or window (a DOI, a PDF on
                // a publisher's site) opens in the reader's browser. Left to
                // itself the webview drops the request and the link does
                // nothing; Papol never opens second windows of its own.
                .on_new_window(|url, _features| {
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
