//! The page a video link leads to, fetched by the application itself.
//!
//! Bilibili tells a phone what a video is — its title and its cover, in
//! the mobile page's og: tags — and tells anything else to run its
//! scripts, which say nothing. So the page must be asked with a phone's
//! User-Agent, and neither a page in the application nor the HTTP plugin
//! can ask that way: `User-Agent` is a forbidden header for a browser,
//! and the plugin builds its headers with the browser's own `Headers`,
//! which drops it without a word. The application has no such rule, so
//! the asking happens here, and linkpeek reads what comes back
//! (`shared/videos.js`). Bilibili refuses Cloudflare's network, so the
//! Cloudflare Worker cannot ask in its place.
//!
//! Only the sites whose video pages Papol reads are fetched, over https,
//! and only their text: this is not a general way out of the page's
//! content security policy.

use std::time::Duration;

use serde::Serialize;

use crate::limits;

const MOBILE_USER_AGENT: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
/// A video page is HTML; a few hundred kilobytes of it is plenty for the
/// tags, and this is what a mobile page actually weighs, doubled.
const LARGEST_PAGE: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct VideoPage {
    /// Where the fetch ended: a b23.tv link names its video only here.
    pub url: String,
    pub html: String,
}

fn video_site(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .as_str(),
            "m.bilibili.com" | "www.bilibili.com" | "bilibili.com" | "b23.tv"
        )
}

/// The video page at `url`, asked for as a phone asks. The
/// `video_page` command (lib.rs).
pub async fn page(url: &str) -> Result<VideoPage, String> {
    let parsed =
        tauri::Url::parse(url.trim()).map_err(|_| "That is not a video link".to_string())?;
    if !video_site(&parsed) {
        return Err("Papol reads video pages from Bilibili only".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(limits::value(
            "timeouts_ms",
            "link_preview",
        )))
        .build()
        .map_err(|error| format!("The video page could not be asked for: {error}"))?;
    let answered = client
        .get(parsed)
        .header(reqwest::header::USER_AGENT, MOBILE_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("The video page could not be reached: {error}"))?;
    if !answered.status().is_success() {
        return Err(format!(
            "The video site answered {}",
            answered.status().as_u16()
        ));
    }
    let landed = answered.url().to_string();
    let bytes = answered
        .bytes()
        .await
        .map_err(|error| format!("The video page could not be read: {error}"))?;
    if bytes.len() > LARGEST_PAGE {
        return Err("The video page is larger than Papol reads".into());
    }
    Ok(VideoPage {
        url: landed,
        html: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::video_site;

    #[test]
    fn only_the_video_sites_papol_reads_are_asked() {
        for allowed in [
            "https://m.bilibili.com/video/BV11kev6cEhk",
            "https://www.bilibili.com/video/av170001",
            "https://bilibili.com/video/BV11kev6cEhk",
            "https://b23.tv/AbC123",
        ] {
            assert!(
                video_site(&tauri::Url::parse(allowed).unwrap()),
                "{allowed}"
            );
        }
        for refused in [
            "http://m.bilibili.com/video/BV11kev6cEhk",
            "https://evil.example/m.bilibili.com",
            "https://bilibili.com.evil.example/x",
            "https://space.bilibili.com/12345",
            "https://127.0.0.1/video/BV11kev6cEhk",
            "file:///etc/passwd",
        ] {
            assert!(
                !video_site(&tauri::Url::parse(refused).unwrap()),
                "{refused}"
            );
        }
    }
}
