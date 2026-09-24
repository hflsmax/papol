//! Take a board card's picture of a web page, as the app does
//! (src/capture.rs), and write it to a file to look at.
//!
//!     cargo run --example capture_probe -- https://example.com/ /tmp/page.jpg

use std::sync::atomic::{AtomicI32, Ordering};

use papol_desktop_lib::capture;

/// What the capture answered, as the process's status. The status Tauri's
/// event loop ends with is 0 whatever code `exit` was given, so a refusal
/// read as a picture to a script checking it; this keeps the code itself.
static STATUS: AtomicI32 = AtomicI32::new(1);

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 3 {
        eprintln!("usage: capture_probe URL OUTPUT.jpg");
        std::process::exit(2);
    }
    // `raw:URL` is taken as it is — a page on this machine, say, to see what
    // WebKit tells a page about itself in the capture window; anything else
    // is held to the app's rule.
    let url = if let Some(raw) = arguments[1].strip_prefix("raw:") {
        tauri::Url::parse(raw).expect("a URL")
    } else {
        capture::checked_url(&arguments[1]).unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(2);
        })
    };
    let output = arguments[2].clone();
    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("build a bare Tauri app");
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let code = match capture::snapshot(&handle, url).await {
            Ok(picture) => {
                std::fs::write(&output, &picture.jpeg).expect("write the picture");
                println!(
                    "{} bytes in {:?} -> {output} ({:?})",
                    picture.jpeg.len(),
                    started.elapsed(),
                    picture.title
                );
                0
            }
            Err(error) => {
                eprintln!("capture failed: {error}");
                1
            }
        };
        STATUS.store(code, Ordering::SeqCst);
        handle.exit(code);
    });
    // The capture window is the probe's only window, and destroying it asks
    // the event loop to end (`ExitRequested` with no code) at the moment the
    // capture hands back its answer — often before the task above has
    // written the picture, said so, or set STATUS, so the probe exited 1
    // with nothing said. Only the task's own `exit` ends the probe.
    app.run_return(|_, event| {
        if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
    std::process::exit(STATUS.load(Ordering::SeqCst));
}
