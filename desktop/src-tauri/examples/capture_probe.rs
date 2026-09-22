//! Take a board card's picture of a web page, as the app does
//! (src/capture.rs), and write it to a file to look at.
//!
//!     cargo run --example capture_probe -- https://example.com/ /tmp/page.jpg

use papol_desktop_lib::capture;

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
                std::fs::write(&output, &picture).expect("write the picture");
                println!("{} bytes in {:?} -> {output}", picture.len(), started.elapsed());
                0
            }
            Err(error) => {
                eprintln!("capture failed: {error}");
                1
            }
        };
        handle.exit(code);
    });
    app.run(|_, _| {});
}
