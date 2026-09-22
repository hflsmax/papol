//! A picture of a web page for a board card, taken on this Mac.
//!
//! The page is loaded in a window of its own that nobody sees, at the size
//! the Worker's browser renders a page (1280 × 800), and WebKit's own
//! snapshot of it becomes the card's file, imported into the nook's store
//! like any other: the card names it, and sync puts it in the bucket before
//! the card. The web asks the Worker for the same picture; the Mac needs
//! nobody. examples/capture_probe.rs takes one outside the app.
//!
//! The window loads whatever site the user pasted, so it is given nothing:
//! its label matches no capability, so the page cannot call Papol; its
//! WebKit session is private, so it neither sees nor keeps any cookie; it
//! may not open windows; and it is destroyed as soon as the picture is
//! taken or the wait gives up. The link is held to the rules the Worker
//! holds it to: a browser scheme, a public-looking host, no credentials.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewWindowBuilder};
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindow};

use crate::data;
use crate::limits;

const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 800.0;
/// After the load event: web fonts, late and progressively loaded images,
/// and a first layout pass. 1.5 s left a site's hero image still blurred.
const SETTLE: Duration = Duration::from_millis(3000);
const JPEG_QUALITY: f64 = 0.8;
/// WebKit answers a snapshot within a frame or two; this is only a guard.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);

static NEXT_CAPTURE: AtomicUsize = AtomicUsize::new(0);

/// The link, if it is one a board card may capture.
pub fn checked_url(value: &str) -> Result<Url, String> {
    let url =
        Url::parse(value.trim()).map_err(|_| "Paste a valid http or https URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Paste a valid http or https URL".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs with embedded credentials are not supported".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.is_empty() || private_host(&host) {
        return Err("Local and private network addresses cannot be captured".into());
    }
    Ok(url)
}

fn private_host(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" || host.ends_with(".localhost") || bare == "0.0.0.0" || bare == "::1" {
        return true;
    }
    if bare.starts_with("fc") || bare.starts_with("fd") {
        return bare.contains(':');
    }
    let octets: Vec<u8> = bare
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect();
    if octets.len() != 4 || bare.split('.').count() != 4 {
        return false;
    }
    matches!(
        (octets[0], octets[1]),
        (127, _) | (10, _) | (192, 168) | (169, 254) | (172, 16..=31)
    )
}

/// Capture the page at `url` and keep the picture in the nook's store.
/// Answers the stored file, which the caller names on the card. The
/// `capture_webpage` command (lib.rs).
pub async fn capture_into(
    app: &AppHandle,
    store: &data::LocalStore,
    url: &str,
) -> Result<data::BlobRecord, String> {
    let url = checked_url(url)?;
    let jpeg = snapshot(app, url).await?;
    store.import_blob(&jpeg, Some("image/jpeg".into()))
}

/// The page's picture as JPEG bytes. Public for examples/capture_probe.rs,
/// which takes one outside the app to see what WebKit draws.
pub async fn snapshot(app: &AppHandle, url: Url) -> Result<Vec<u8>, String> {
    let label = format!("capture-{}", NEXT_CAPTURE.fetch_add(1, Ordering::Relaxed));
    let (loaded_tx, loaded_rx) = tokio::sync::oneshot::channel::<()>();
    let loaded = Mutex::new(Some(loaded_tx));
    // Shown, but never seen: WebKit tells a page in a window that is not
    // shown that it is hidden — one animation frame, throttled timers — and
    // pages that load their images from script (lazy loading, a blurred
    // placeholder swapped for the picture) never finish in one. So the
    // window is shown, far off every screen, frameless, fully transparent
    // and deaf to the mouse, never focused, and its view is told not to
    // count the window as covered (`unseen`). Measured: `visible`, sixty
    // frames a second, and the picture the page really shows.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("Papol page capture")
        .inner_size(WIDTH, HEIGHT)
        .position(-40_000.0, -40_000.0)
        .decorations(false)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .incognito(true)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(tx) = loaded.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(());
                }
            }
        })
        .build()
        .map_err(|error| format!("The page could not be opened for its picture: {error}"))?;

    let taken = async {
        unseen(&window).await?;
        window
            .show()
            .map_err(|error| format!("The page could not be opened for its picture: {error}"))?;
        let wait = Duration::from_millis(limits::value("timeouts_ms", "media_capture"));
        match tokio::time::timeout(wait, loaded_rx).await {
            Err(_) => return Err("The page took too long to load".to_string()),
            Ok(Err(_)) => return Err("The page closed before it loaded".to_string()),
            Ok(Ok(())) => {}
        }
        tokio::time::sleep(SETTLE).await;
        take(&window).await
    }
    .await;
    let _ = window.destroy();
    taken
}

/// Make the capture window invisible and click-through before it is shown.
#[cfg(target_os = "macos")]
async fn unseen(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::NSWindow;

    let failed =
        |error: tauri::Error| format!("The page could not be opened for its picture: {error}");
    // A raw pointer is not Send; its address is, and the window outlives this.
    let ns_window = window.ns_window().map_err(failed)? as usize;
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    window
        .run_on_main_thread(move || {
            // SAFETY: the address is the live NSWindow of the capture window,
            // and this runs on the main thread, where AppKit must be called.
            unsafe {
                let ns_window = &*(ns_window as *const NSWindow);
                ns_window.setAlphaValue(0.0);
                ns_window.setIgnoresMouseEvents(true);
                ns_window.setHasShadow(false);
            }
            let _ = tx.send(());
        })
        .map_err(failed)?;
    rx.await
        .map_err(|_| "The page could not be opened for its picture".to_string())?;

    // An invisible window still counts as covered, and WebKit then tells
    // the page it is hidden: one animation frame and throttled timers
    // (measured). WebKit's own switch for a view rendered where nobody
    // looks turns that off. It is not public API, so it is asked for only
    // where the view answers to it; without it the picture is taken all
    // the same, of whatever the page drew while it thought it was hidden.
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    window
        .with_webview(move |platform| {
            use objc2::runtime::AnyObject;
            use objc2::{msg_send, sel};
            // SAFETY: on macOS the platform webview is the window's
            // WKWebView; this runs on the main thread; the selector is sent
            // only when the view says it answers to it, with the one BOOL
            // argument it takes.
            unsafe {
                let view = &*(platform.inner() as *const AnyObject);
                let switch = sel!(_setWindowOcclusionDetectionEnabled:);
                let answers: bool = msg_send![view, respondsToSelector: switch];
                if answers {
                    let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: false];
                }
            }
            let _ = tx.send(());
        })
        .map_err(failed)?;
    rx.await
        .map_err(|_| "The page could not be opened for its picture".to_string())
}

#[cfg(not(target_os = "macos"))]
async fn unseen(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
async fn take(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::WKWebView;

    type Taken = Result<Vec<u8>, String>;
    let (tx, rx) = tokio::sync::oneshot::channel::<Taken>();
    let reply = Arc::new(Mutex::new(Some(tx)));

    window
        .with_webview(move |platform| {
            let answer = move |result: Taken| {
                if let Some(tx) = reply.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(result);
                }
            };
            let handler = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                // SAFETY: WebKit hands the block a live image or a live
                // error, borrowed for the length of the call.
                let result = unsafe {
                    match image.as_ref() {
                        Some(image) => jpeg_of(image),
                        None => Err(error
                            .as_ref()
                            .map(|error| error.localizedDescription().to_string())
                            .unwrap_or_else(|| "WebKit took no picture".into())),
                    }
                };
                answer(result);
            });
            // SAFETY: on macOS the platform webview is the window's
            // WKWebView, and Tauri runs this on the main thread, where
            // WebKit must be called. The whole view, at the screen's scale.
            unsafe {
                let view = &*(platform.inner() as *const WKWebView);
                view.takeSnapshotWithConfiguration_completionHandler(None, &handler);
            }
        })
        .map_err(|error| format!("The page's picture could not be taken: {error}"))?;

    match tokio::time::timeout(SNAPSHOT_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        _ => Err("The page's picture could not be taken".into()),
    }
}

/// The snapshot as JPEG bytes. At a Retina display's scale a page is
/// 2560 × 1600, which as PNG came to 4.5 MB; a photograph-like page
/// compresses far better as JPEG, and the card shows it no worse.
#[cfg(target_os = "macos")]
fn jpeg_of(image: &objc2_app_kit::NSImage) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImageCompressionFactor};
    use objc2_foundation::{NSDictionary, NSNumber};

    let tiff = image
        .TIFFRepresentation()
        .ok_or("The page's picture was empty")?;
    let bitmap =
        NSBitmapImageRep::imageRepWithData(&tiff).ok_or("The page's picture could not be read")?;
    let quality = NSNumber::new_f64(JPEG_QUALITY);
    // SAFETY: NSImageCompressionFactor is AppKit's constant key, and its
    // value is an NSNumber between 0 and 1, as the property requires.
    let jpeg = unsafe {
        let properties =
            NSDictionary::from_slices(&[NSImageCompressionFactor], &[&*quality as &AnyObject]);
        bitmap.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties)
    }
    .ok_or("The page's picture could not be encoded")?;
    let bytes = jpeg.to_vec();
    if bytes.is_empty() {
        return Err("The page's picture was empty".into());
    }
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
async fn take(_window: &WebviewWindow) -> Result<Vec<u8>, String> {
    Err("Page pictures are taken on macOS only".into())
}

#[cfg(test)]
mod tests {
    use super::checked_url;

    #[test]
    fn a_card_captures_public_web_pages_only() {
        assert!(checked_url("https://flexible.seas.ucla.edu/").is_ok());
        assert!(checked_url("http://example.com/a?b=c").is_ok());
        for refused in [
            "ftp://example.com/",
            "https://user:pw@example.com/",
            "http://localhost:8000/",
            "http://app.localhost/",
            "http://127.0.0.1/",
            "http://10.0.0.1/x",
            "http://192.168.1.1/",
            "http://172.20.1.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/",
            "not a url",
        ] {
            assert!(checked_url(refused).is_err(), "{refused}");
        }
        // A hostname that merely begins with digits is a name, not an address.
        assert!(checked_url("https://10times.com/").is_ok());
    }
}
