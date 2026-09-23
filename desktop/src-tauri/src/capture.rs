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
/// After the page says it has gone quiet: one more layout and paint.
const SETTLE: Duration = Duration::from_millis(600);
/// How long to wait for that word. A page built entirely by its scripts
/// (Instagram) draws nothing for seconds after its load event, and was
/// photographed blank when the wait was a flat three seconds.
const QUIET_TIMEOUT: Duration = Duration::from_millis(15_000);
/// How often the window is asked what the page has titled itself.
const QUIET_POLL: Duration = Duration::from_millis(150);
/// What the page titles itself once it has stopped changing. A window
/// with no capabilities cannot call Papol — that is the point of it — so
/// the page says this in the one place the application can read.
const QUIET_TITLE: &str = "papol-capture-quiet";
/// Watches the page and titles it once it has stopped changing and has
/// something to show: no DOM mutations, no resources arriving, the
/// document complete, and text or a picture in view. Planted in every
/// document the window loads, before the page's own scripts run.
const QUIET_SCRIPT: &str = concat!(
    include_str!("../scripts/capture-page.js"),
    "\npapolCapture.watch();"
);
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
    if url.host().is_none_or(private_host) {
        return Err("Local and private network addresses cannot be captured".into());
    }
    Ok(url)
}

/// Whether a host is this machine or its network: a loopback, private,
/// link-local, shared (CGNAT) or unspecified address in any form the URL
/// parser reads (`127.1`, `2130706433`, `0x7f.1` and `[::ffff:127.0.0.1]`
/// all arrive as addresses), or a name only a local network answers to.
pub fn private_host(host: url::Host<&str>) -> bool {
    use std::net::{Ipv4Addr, Ipv6Addr};
    fn v4(address: Ipv4Addr) -> bool {
        let [a, b, ..] = address.octets();
        address.is_private()
            || address.is_loopback()
            || address.is_link_local()
            || address.is_unspecified()
            || address.is_broadcast()
            || a == 0
            || (a == 100 && (64..=127).contains(&b))
    }
    fn v6(address: Ipv6Addr) -> bool {
        let first = address.segments()[0];
        address.is_loopback()
            || address.is_unspecified()
            || (first & 0xfe00) == 0xfc00 // unique local, fc00::/7
            || (first & 0xffc0) == 0xfe80 // link-local, fe80::/10
            || address.to_ipv4_mapped().is_some_and(v4)
    }
    match host {
        url::Host::Ipv4(address) => v4(address),
        url::Host::Ipv6(address) => v6(address),
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name.is_empty()
                || ["localhost", "local", "internal", "home.arpa", "lan"]
                    .iter()
                    .any(|suffix| name == *suffix || name.ends_with(&format!(".{suffix}")))
        }
    }
}

/// WebKit's rules for the capture window: no load of any kind — the page,
/// a redirect, a frame, an image, a socket — to this machine or its
/// network. `checked_url` refuses such a link outright; these hold for
/// wherever the page goes next, which a check of the pasted link cannot.
/// Content-blocker patterns take no alternation, hence one rule a pattern.
pub fn private_network_rules() -> String {
    const SCHEME: &str = "^[a-z][a-z0-9+.-]*://";
    let hosts = [
        // Loopback, private and link-local IPv4, the unspecified network,
        // and shared (CGNAT) 100.64.0.0/10.
        "0\\.",
        "127\\.",
        "10\\.",
        "192\\.168\\.",
        "169\\.254\\.",
        "172\\.1[6-9]\\.",
        "172\\.2[0-9]\\.",
        "172\\.3[01]\\.",
        "100\\.6[4-9]\\.",
        "100\\.[7-9][0-9]\\.",
        "100\\.1[01][0-9]\\.",
        "100\\.12[0-7]\\.",
        // Any IPv6 literal: public sites are not visited by address.
        "\\[",
        // Names only a local network answers to.
        "localhost[:/]",
        "[^/:]*\\.localhost[:/]",
        "[^/:]*\\.local[:/]",
        "[^/:]*\\.internal[:/]",
        "[^/:]*\\.home\\.arpa[:/]",
        "[^/:]*\\.lan[:/]",
    ];
    let rules: Vec<serde_json::Value> = hosts
        .iter()
        .map(|host| {
            serde_json::json!({
                "trigger": { "url-filter": format!("{SCHEME}{host}") },
                "action": { "type": "block" },
            })
        })
        .collect();
    serde_json::Value::Array(rules).to_string()
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
    // How the wait ends: the page loaded, or it set off for this machine or
    // its network, which the rules block and this says at once rather than
    // after the whole wait.
    let (settled_tx, settled_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let settled = Arc::new(Mutex::new(Some(settled_tx)));
    let settle = move |outcome: Result<(), String>| {
        let slot = settled.lock().ok().and_then(|mut slot| slot.take());
        if let Some(tx) = slot {
            let _ = tx.send(outcome);
        }
    };
    let on_load = settle.clone();
    let on_navigation = settle;
    let blank = Url::parse("about:blank").expect("about:blank is a URL");
    // Shown, but never seen: WebKit tells a page in a window that is not
    // shown that it is hidden — one animation frame, throttled timers — and
    // pages that load their images from script (lazy loading, a blurred
    // placeholder swapped for the picture) never finish in one. So the
    // window is shown, far off every screen, frameless, fully transparent
    // and deaf to the mouse, never focused, and its view is told not to
    // count the window as covered (`unseen`). Measured: `visible`, sixty
    // frames a second, and the picture the page really shows.
    //
    // The window opens on a blank page, and goes to the link only once the
    // rules that keep it off this machine's network are in place.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .title("Papol page capture")
        .inner_size(WIDTH, HEIGHT)
        .position(-40_000.0, -40_000.0)
        .decorations(false)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .incognito(true)
        // The watcher is planted in every page the window holds, before
        // any of its own scripts run. Evaluating it after the load event
        // reaches only the first document, and a site that answers with
        // a shell and then goes somewhere else (Etsy's search results)
        // left the real page unwatched: the wait ran its full length.
        .initialization_script(QUIET_SCRIPT)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_navigation(move |to| {
            if to.scheme() == "about" || to.host().is_some_and(|host| !private_host(host)) {
                return true;
            }
            on_navigation(Err(
                "The page leads to a local or private network address".into()
            ));
            false
        })
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished && payload.url().scheme() != "about" {
                on_load(Ok(()));
            }
        })
        .build()
        .map_err(|error| format!("The page could not be opened for its picture: {error}"))?;

    let taken = async {
        unseen(&window).await?;
        guard(&window).await?;
        window
            .show()
            .map_err(|error| format!("The page could not be opened for its picture: {error}"))?;
        window
            .navigate(url)
            .map_err(|error| format!("The page could not be opened for its picture: {error}"))?;
        let wait = Duration::from_millis(limits::value("timeouts_ms", "media_capture"));
        match tokio::time::timeout(wait, settled_rx).await {
            Err(_) => return Err("The page took too long to load".to_string()),
            Ok(Err(_)) => return Err("The page closed before it loaded".to_string()),
            Ok(Ok(outcome)) => outcome?,
        }
        let showing = quiet(&window).await;
        if showing.is_some_and(|showing| !showing.worth_a_picture()) {
            return Err("The page showed nothing to make a picture of".to_string());
        }
        tokio::time::sleep(SETTLE).await;
        take(&window).await
    }
    .await;
    let _ = window.destroy();
    taken
}

/// Keep the capture window off this machine's network: WebKit compiles
/// `private_network_rules` and the view's content controller takes them,
/// before the window goes anywhere. No rules, no capture.
#[cfg(target_os = "macos")]
async fn guard(window: &WebviewWindow) -> Result<(), String> {
    use objc2_foundation::{MainThreadMarker, NSError, NSString};
    use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebView};

    type Guarded = Result<(), String>;
    let (tx, rx) = tokio::sync::oneshot::channel::<Guarded>();
    let reply = Arc::new(Mutex::new(Some(tx)));
    let rules = private_network_rules();
    window
        .with_webview(move |platform| {
            let answer = move |result: Guarded| {
                if let Some(tx) = reply.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(result);
                }
            };
            let Some(main_thread) = MainThreadMarker::new() else {
                return answer(Err(
                    "The page's guard could not be set off the main thread".into()
                ));
            };
            // SAFETY: on macOS the platform webview is the window's
            // WKWebView, and this runs on the main thread, where WebKit
            // must be called. The view outlives the compile: the window is
            // destroyed only after this answers or the capture gives up.
            unsafe {
                let view: &WKWebView = &*(platform.inner() as *const WKWebView);
                let controller = view.configuration().userContentController();
                let Some(store) = WKContentRuleListStore::defaultStore(main_thread) else {
                    return answer(Err("WebKit has no store for the page's guard".into()));
                };
                let handler = block2::RcBlock::new(
                    move |list: *mut WKContentRuleList, error: *mut NSError| {
                        let result = match list.as_ref() {
                            Some(list) => {
                                controller.addContentRuleList(list);
                                Ok(())
                            }
                            None => Err(error
                                .as_ref()
                                .map(|error| error.localizedDescription().to_string())
                                .unwrap_or_else(|| "WebKit refused the page's guard".into())),
                        };
                        answer(result);
                    },
                );
                store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
                    Some(&NSString::from_str("papol-capture-private-network")),
                    Some(&NSString::from_str(&rules)),
                    Some(&handler),
                );
            }
        })
        .map_err(|error| format!("The page's guard could not be set: {error}"))?;
    match tokio::time::timeout(SNAPSHOT_TIMEOUT, rx).await {
        Ok(Ok(result)) => {
            result.map_err(|error| format!("The page's guard could not be set: {error}"))
        }
        _ => Err("The page's guard could not be set".into()),
    }
}

#[cfg(not(target_os = "macos"))]
async fn guard(_window: &WebviewWindow) -> Result<(), String> {
    Err("Page pictures are taken on macOS only".into())
}

/// What a page says it is showing when it has gone quiet: the length of
/// its text, how many pictures and drawings are in view, and — for a page
/// that draws with neither — how many different things it paints.
#[derive(serde::Deserialize, Default)]
struct Showing {
    text: usize,
    pictures: usize,
    drawings: usize,
    #[serde(default)]
    fills: usize,
}

impl Showing {
    /// A page with a line of text on one flat colour is a wall, an error
    /// or an empty shell — whatever it is, a picture of it is a blank
    /// rectangle, and the card is better off as the link it already is.
    /// The page's own `worth` (scripts/capture-page.js) says the same, to
    /// decide when it has something worth waiting for.
    fn worth_a_picture(&self) -> bool {
        self.text > 40 || self.pictures > 0 || self.drawings > 0 || self.fills > 1
    }
}

/// Wait until the page has stopped changing, or until waiting is no
/// longer worth it, and answer what it says it is showing. A page that
/// will not settle — one that animates forever, or whose scripts the
/// watcher could not be planted in — is photographed as it stands, which
/// is what the flat wait did for every page before, and nothing is
/// claimed about what it shows.
async fn quiet(window: &WebviewWindow) -> Option<Showing> {
    let deadline = tokio::time::Instant::now() + QUIET_TIMEOUT;
    while tokio::time::Instant::now() < deadline {
        // The page's own title, not the window's: what a document calls
        // itself never reaches the frame around it.
        if let Some(title) = page_title(window).await {
            if let Some(rest) = title.strip_prefix(QUIET_TITLE) {
                return serde_json::from_str(rest.trim_start_matches(':')).ok();
            }
        }
        tokio::time::sleep(QUIET_POLL).await;
    }
    None
}

/// What the page in the capture window calls itself.
#[cfg(target_os = "macos")]
async fn page_title(window: &WebviewWindow) -> Option<String> {
    use objc2_web_kit::WKWebView;

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let reply = Arc::new(Mutex::new(Some(tx)));
    window
        .with_webview(move |platform| {
            // SAFETY: on macOS the platform webview is the window's
            // WKWebView, and this runs on the main thread, where WebKit
            // must be read.
            let title = unsafe {
                let view: &WKWebView = &*(platform.inner() as *const WKWebView);
                view.title().map(|title| title.to_string())
            };
            if let Some(tx) = reply.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = tx.send(title);
            }
        })
        .ok()?;
    rx.await.ok().flatten()
}

#[cfg(not(target_os = "macos"))]
async fn page_title(_window: &WebviewWindow) -> Option<String> {
    None
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
    fn a_page_showing_nothing_is_worth_no_picture() {
        use super::Showing;
        let nothing = Showing::default();
        assert!(!nothing.worth_a_picture());
        // A shell that has not handed over yet, and a wall with a line on
        // it, are the same white rectangle to a card.
        assert!(!Showing {
            text: 24,
            ..Showing::default()
        }
        .worth_a_picture());
        // A single flat colour is what a shell and a wall both look like.
        assert!(!Showing {
            fills: 1,
            ..Showing::default()
        }
        .worth_a_picture());
        // Words, a picture, a drawing, or paint in more than one colour:
        // any one of them is a picture.
        for showing in [
            Showing {
                text: 2909,
                ..Showing::default()
            },
            Showing {
                pictures: 1,
                ..Showing::default()
            },
            Showing {
                drawings: 1,
                ..Showing::default()
            },
            Showing {
                fills: 2,
                ..Showing::default()
            },
        ] {
            assert!(showing.worth_a_picture());
        }
    }

    /// The same rule as the page's own `worth`, which decides when to stop
    /// waiting; frontend/src/capturePage.test.js holds that side of it.
    #[test]
    fn the_page_and_the_application_measure_a_picture_the_same_way() {
        let script = include_str!("../scripts/capture-page.js");
        assert!(script.contains(
            "report.text > 40 || report.pictures > 0 || report.drawings > 0 || report.fills > 1"
        ));
        // And the wait ends on a page that has gone still *and* has
        // something in it, never on stillness alone.
        assert!(script.contains("(still && worth(showing()))"));
    }

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
            // Every other way to write this machine or its network.
            "http://2130706433/",
            "http://0x7f.1/",
            "http://127.1/",
            "http://0.1.2.3/",
            "http://100.64.0.1/",
            "http://255.255.255.255/",
            "http://[::]/",
            "http://[fe80::1]/",
            "http://[fd12:3456::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://localhost./",
            "http://printer.local/",
            "http://router.lan/",
            "http://nas.home.arpa/",
            "http://metadata.google.internal/",
            "not a url",
        ] {
            assert!(checked_url(refused).is_err(), "{refused}");
        }
        // A hostname that merely begins with digits is a name, not an address,
        // and a public address, or a name that only contains a local word, is fine.
        for public in [
            "https://10times.com/",
            "http://100.128.0.1/",
            "http://172.32.0.1/",
            "https://[2606:4700::1111]/",
            "https://localhost-tools.dev/",
            "https://locale.example/",
        ] {
            assert!(checked_url(public).is_ok(), "{public}");
        }
    }

    #[test]
    fn the_capture_window_is_kept_off_the_network_it_runs_on() {
        use super::private_network_rules;
        let rules: serde_json::Value = serde_json::from_str(&private_network_rules()).unwrap();
        let rules = rules.as_array().unwrap();
        assert!(rules.iter().all(|rule| rule["action"]["type"] == "block"
            && rule["trigger"]["url-filter"]
                .as_str()
                .unwrap()
                .starts_with("^[a-z]")));
        // The patterns, as WebKit reads them, against the URLs they must
        // catch and those they must let through. WebKit's pattern language
        // is a subset of the regular expressions tested here.
        let patterns: Vec<regex::Regex> = rules
            .iter()
            .map(|rule| regex::Regex::new(rule["trigger"]["url-filter"].as_str().unwrap()).unwrap())
            .collect();
        let blocked = |url: &str| patterns.iter().any(|pattern| pattern.is_match(url));
        for url in [
            "http://127.0.0.1/",
            "https://10.1.2.3:8443/admin",
            "http://192.168.1.1/",
            "http://172.16.0.1/",
            "http://172.31.255.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://100.64.0.1/",
            "http://100.127.0.1/",
            "http://0.0.0.0/",
            "http://[::1]/",
            "ws://127.0.0.1:9222/devtools",
            "http://localhost:8080/",
            "http://localhost/",
            "http://app.localhost/",
            "http://printer.local/",
            "http://router.lan/",
            "http://nas.home.arpa/",
            "http://metadata.google.internal/",
        ] {
            assert!(blocked(url), "not blocked: {url}");
        }
        for url in [
            "https://flexible.seas.ucla.edu/",
            "https://100.128.0.1/",
            "https://172.32.0.1/",
            "https://10times.com/",
            "https://localhost-tools.dev/",
            "https://example.com/local/page",
            "https://cdn.example.com/?next=http://127.0.0.1/",
        ] {
            assert!(!blocked(url), "blocked: {url}");
        }
    }
}
