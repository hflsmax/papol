use crate::data::{declared_schema_version, BlobKind, LocalStore, RemoteChange};
use crate::limits::value as app_limit;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Where the verdict is kept between launches, so a window opened offline
/// still says what the server last said rather than starting hopeful.
pub(crate) const COMPATIBILITY_KEY: &str = "client_compatibility";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FailureKind {
    Transient,
    Permanent,
    /// This build is older than the server will speak to. Not transient —
    /// retrying cannot help — and not permanent in the per-mutation sense
    /// either: nothing is wrong with the work, so it stays in the outbox
    /// for a version that can send it.
    Incompatible,
}

#[derive(Debug)]
struct SyncFailure {
    kind: FailureKind,
    message: String,
}

impl SyncFailure {
    fn transient(error: impl ToString) -> Self {
        Self {
            kind: FailureKind::Transient,
            message: error.to_string(),
        }
    }

    fn permanent(error: impl ToString) -> Self {
        Self {
            kind: FailureKind::Permanent,
            message: error.to_string(),
        }
    }
}

pub struct Coordinator {
    client: Client,
    gate: Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub pushed: usize,
    pub pulled: usize,
    pub cursor: i64,
}

/// Which way a sync goes. A push alone publishes what a server action is
/// about to refer to; a pull alone reconciles without sending anything,
/// which is what a manual-mode replica does in the background.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncMode {
    #[default]
    Full,
    Push,
    Pull,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ReconcileOptions {
    pub retry_blocked: bool,
    pub mode: SyncMode,
}

/// The four stages of a sync, in the order they run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    Uploading,
    Snapshot,
    Pulling,
    Downloading,
}

impl SyncPhase {
    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncProgress {
    pub phase: SyncPhase,
    /// Items finished in this phase: mutations, pull pages or files.
    pub completed: usize,
    /// Items in this phase, when known in advance. Pull pages are not.
    pub total: Option<usize>,
    /// Whole-sync progress in [0, 1]. Each phase is an equal quarter, so the
    /// value only moves forward even when a later phase discovers more work.
    pub fraction: f64,
    /// Bytes sent and received during this sync.
    pub bytes: u64,
    pub bytes_per_second: f64,
}

const SPEED_WINDOW: Duration = Duration::from_secs(3);
const REPORT_INTERVAL: Duration = Duration::from_millis(100);
/// A connection can die mid-body on a network blip or handoff. The sync
/// routes are idempotent reads, so a fresh request is always safe; only
/// after this many attempts does one transfer take the whole sync down.
const TRANSFER_ATTEMPTS: usize = 3;
const RETRY_PAUSE: Duration = Duration::from_secs(1);

/// Counts transferred bytes and reports throttled progress for one sync.
struct Meter<'a> {
    report: &'a (dyn Fn(SyncProgress) + Send + Sync),
    phase: SyncPhase,
    completed: usize,
    total: Option<usize>,
    /// Progress through the item currently transferring, from Content-Length.
    item_fraction: f64,
    fraction: f64,
    bytes: u64,
    samples: VecDeque<(Instant, u64)>,
    last_report: Option<Instant>,
}

impl<'a> Meter<'a> {
    fn new(report: &'a (dyn Fn(SyncProgress) + Send + Sync)) -> Self {
        Self {
            report,
            phase: SyncPhase::Uploading,
            completed: 0,
            total: None,
            item_fraction: 0.0,
            fraction: 0.0,
            bytes: 0,
            samples: VecDeque::from([(Instant::now(), 0)]),
            last_report: None,
        }
    }

    fn begin(&mut self, phase: SyncPhase, total: Option<usize>) {
        self.phase = phase;
        self.completed = 0;
        self.total = total;
        self.item_fraction = 0.0;
        self.emit(true);
    }

    fn transferred(&mut self, bytes: u64, item_fraction: Option<f64>) {
        self.bytes += bytes;
        if let Some(fraction) = item_fraction {
            self.item_fraction = fraction.clamp(0.0, 1.0);
        }
        self.emit(false);
    }

    fn item_done(&mut self) {
        self.completed += 1;
        self.item_fraction = 0.0;
        self.emit(true);
    }

    fn finish(&mut self) {
        self.fraction = 1.0;
        self.emit(true);
    }

    fn bytes_per_second(&mut self, now: Instant) -> f64 {
        self.samples.push_back((now, self.bytes));
        while self.samples.len() > 2 && now.duration_since(self.samples[0].0) > SPEED_WINDOW {
            self.samples.pop_front();
        }
        let (since, bytes) = self.samples[0];
        let elapsed = now.duration_since(since).as_secs_f64();
        if elapsed < 0.2 {
            return 0.0;
        }
        (self.bytes - bytes) as f64 / elapsed
    }

    fn emit(&mut self, force: bool) {
        let now = Instant::now();
        if !force
            && self
                .last_report
                .is_some_and(|last| now.duration_since(last) < REPORT_INTERVAL)
        {
            return;
        }
        self.last_report = Some(now);
        let phase_fraction = match self.total {
            Some(0) => 1.0,
            Some(total) => ((self.completed as f64 + self.item_fraction) / total as f64).min(1.0),
            None => 0.0,
        };
        let overall = (self.phase.index() as f64 + phase_fraction) / 4.0;
        self.fraction = self.fraction.max(overall);
        let bytes_per_second = self.bytes_per_second(now);
        (self.report)(SyncProgress {
            phase: self.phase,
            completed: self.completed,
            total: self.total.map(|total| total.max(self.completed)),
            fraction: self.fraction,
            bytes: self.bytes,
            bytes_per_second,
        });
    }
}

/// Reads a response body chunk by chunk so the meter sees bytes as they
/// arrive rather than once the whole file is in memory.
async fn read_body(
    mut response: reqwest::Response,
    meter: &mut Meter<'_>,
) -> Result<Vec<u8>, reqwest::Error> {
    let length = response.content_length().filter(|length| *length > 0);
    let mut body = Vec::with_capacity(length.unwrap_or(0).min(64 << 20) as usize);
    while let Some(chunk) = response.chunk().await? {
        body.extend_from_slice(&chunk);
        meter.transferred(
            chunk.len() as u64,
            length.map(|length| body.len() as f64 / length as f64),
        );
    }
    Ok(body)
}

/// The server's answer to where a file's bytes go (cloudflare/src/files.ts).
#[derive(Deserialize)]
struct UploadAddress {
    stored: bool,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct PushResponse {
    rows: Vec<Map<String, Value>>,
    #[serde(default)]
    conflicts: Vec<Value>,
    #[serde(default)]
    aliases: Map<String, Value>,
}

#[derive(Deserialize)]
struct PullResponse {
    cursor: i64,
    has_more: bool,
    changes: Vec<RemoteChange>,
}

#[derive(Deserialize)]
struct SnapshotResponse {
    rows: Vec<Map<String, Value>>,
}

impl Coordinator {
    pub fn new() -> Result<Self, String> {
        // The schema this build was compiled for goes on every request; the
        // server compares it with its own and answers 426 to any other. The
        // release version is recorded beside the client's cursor, so who runs
        // what can be read off the table.
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "X-Papol-Schema",
            reqwest::header::HeaderValue::from_str(&declared_schema_version().to_string())
                .map_err(|error| error.to_string())?,
        );
        let client = Client::builder()
            .default_headers(headers)
            .user_agent(concat!("Papol macOS/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_millis(app_limit(
                "timeouts_ms",
                "sync_connect",
            )))
            // No whole-request deadline: a first sync honestly takes as long
            // as its papers do, and a deadline would fail the same large
            // blob on every attempt. A transfer that keeps moving is
            // healthy; the read timeout is what catches a stalled one.
            .read_timeout(Duration::from_millis(app_limit("timeouts_ms", "sync_read")))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            client,
            gate: Mutex::new(()),
        })
    }

    pub async fn synchronize(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend_url: &str,
        token: &str,
    ) -> Result<SyncResult, String> {
        let ignore = |_: SyncProgress| {};
        self.synchronize_with_progress(
            store,
            account_uuid,
            backend_url,
            token,
            ReconcileOptions::default(),
            &ignore,
        )
        .await
    }

    async fn push_pending(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend: &Url,
        token: &str,
        meter: &mut Meter<'_>,
    ) -> Result<usize, String> {
        meter.begin(
            SyncPhase::Uploading,
            Some(store.pending_count(account_uuid)?),
        );
        let mut pushed = 0;
        while let Some(mutation) = store.next_outbox(account_uuid)? {
            let attempted: Result<PushResponse, SyncFailure> = async {
                for change in &mutation.changes {
                    let Some(sha256) = change.values.get("sha256").and_then(Value::as_str) else {
                        continue;
                    };
                    // The bytes go into the bucket by the address the server
                    // gives — the bucket's own door, with the headers it lists
                    // and no credential of ours — or nowhere, when the server
                    // says it holds them already. The row that names them is
                    // pushed after.
                    let kind = if change.table == "papers" {
                        BlobKind::Paper
                    } else {
                        BlobKind::BoardFile
                    };
                    let bytes = store.read_blob(sha256).map_err(SyncFailure::permanent)?;
                    let mime = change
                        .values
                        .get("mime_type")
                        .and_then(Value::as_str)
                        .unwrap_or(match kind {
                            BlobKind::Paper => "application/pdf",
                            BlobKind::BoardFile => "application/octet-stream",
                        });
                    let name = change
                        .values
                        .get("original_filename")
                        .and_then(Value::as_str)
                        .unwrap_or(match kind {
                            BlobKind::Paper => "paper.pdf",
                            BlobKind::BoardFile => "file",
                        });
                    let address = self
                        .upload_address(backend, token, kind, sha256, bytes.len(), name, mime)
                        .await?;
                    if address.stored {
                        continue;
                    }
                    let size = bytes.len() as u64;
                    let url = backend
                        .join(address.url.trim_start_matches('/'))
                        .map_err(SyncFailure::transient)?;
                    let mut request = self.client.put(url).body(bytes);
                    for (header, value) in &address.headers {
                        request = request.header(header.as_str(), value.as_str());
                    }
                    let uploaded = request.send().await.map_err(SyncFailure::transient)?;
                    if !uploaded.status().is_success() {
                        return Err(http_error(uploaded).await);
                    }
                    meter.transferred(size, None);
                }
                let url = backend
                    .join("api/sync/push")
                    .map_err(SyncFailure::transient)?;
                let body = serde_json::to_vec(&mutation).map_err(SyncFailure::permanent)?;
                let size = body.len() as u64;
                let response = self
                    .client
                    .post(url)
                    .bearer_auth(token)
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(body)
                    .send()
                    .await
                    .map_err(SyncFailure::transient)?;
                if !response.status().is_success() {
                    return Err(http_error(response).await);
                }
                meter.transferred(size, None);
                let body = read_body(response, meter)
                    .await
                    .map_err(SyncFailure::transient)?;
                serde_json::from_slice(&body).map_err(SyncFailure::transient)
            }
            .await;
            let result = match attempted {
                Ok(result) => result,
                Err(failure) => {
                    if failure.kind == FailureKind::Incompatible {
                        // The mutation is untouched: it is this program the
                        // server refused, not the user's work.
                        store.set_local_setting(COMPATIBILITY_KEY, "incompatible")?;
                        return Err(failure.message);
                    }
                    let blocked = failure.kind == FailureKind::Permanent;
                    store.record_outbox_error(
                        account_uuid,
                        mutation.local_sequence,
                        &failure.message,
                        blocked,
                    )?;
                    if blocked {
                        continue;
                    }
                    return Err(failure.message);
                }
            };
            store
                .accept_push(
                    account_uuid,
                    mutation.local_sequence,
                    result.rows,
                    result.conflicts,
                    result.aliases,
                )
                .map_err(|error| format!("Applying pushed rows failed: {error}"))?;
            pushed += 1;
            meter.item_done();
        }
        Ok(pushed)
    }

    pub(crate) async fn synchronize_with_progress(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend_url: &str,
        token: &str,
        options: ReconcileOptions,
        report: &(dyn Fn(SyncProgress) + Send + Sync),
    ) -> Result<SyncResult, String> {
        let _guard = self.gate.lock().await;
        let backend = validated_backend(backend_url)?;
        if token.trim().is_empty() {
            return Err("Sync requires a signed-in account".into());
        }
        if options.retry_blocked && options.mode != SyncMode::Pull {
            store.retry_blocked_outbox(account_uuid)?;
        }
        let mut meter = Meter::new(report);
        let pushed = if options.mode == SyncMode::Pull {
            0
        } else {
            self.push_pending(store, account_uuid, &backend, token, &mut meter)
                .await?
        };
        if options.mode == SyncMode::Push {
            meter.finish();
            return Ok(SyncResult {
                pushed,
                pulled: 0,
                cursor: store.pull_cursor(account_uuid)?,
            });
        }

        // When uploads are enabled, push first so aliases can collapse a
        // temporary offline import before a snapshot introduces the same
        // paper UUID. Pull-only reconciliation leaves the outbox
        // untouched; snapshot application already preserves pending rows.
        meter.begin(SyncPhase::Snapshot, Some(1));
        let snapshot_url = backend
            .join("api/sync/snapshot")
            .map_err(|error| error.to_string())?;
        let snapshot = match self.fetch(&snapshot_url, Some(token), &mut meter).await {
            Ok((_, body)) => body,
            Err(failure) => {
                // The snapshot is gated like the pull, and an empty outbox
                // means it answers first: without this, an outdated build
                // with nothing to push would never learn it is outdated.
                if failure.kind == FailureKind::Incompatible {
                    store.set_local_setting(COMPATIBILITY_KEY, "incompatible")?;
                }
                return Err(failure.message);
            }
        };
        let snapshot: SnapshotResponse =
            serde_json::from_slice(&snapshot).map_err(|error| error.to_string())?;
        store
            .apply_snapshot(account_uuid, snapshot.rows)
            .map_err(|error| format!("Applying snapshot failed: {error}"))?;
        meter.item_done();

        meter.begin(SyncPhase::Pulling, None);
        let mut pulled = 0;
        let mut cursor = store.pull_cursor(account_uuid)?;
        let client_uuid = store.client_uuid()?;
        loop {
            let mut url = backend
                .join("api/sync/pull")
                .map_err(|error| error.to_string())?;
            url.query_pairs_mut()
                .append_pair("cursor", &cursor.to_string())
                .append_pair("client_uuid", &client_uuid)
                .append_pair(
                    "limit",
                    &app_limit("counts", "sync_pull_default").to_string(),
                );
            let page = match self.fetch(&url, Some(token), &mut meter).await {
                Ok((_, body)) => body,
                Err(failure) => {
                    if failure.kind == FailureKind::Incompatible {
                        store.set_local_setting(COMPATIBILITY_KEY, "incompatible")?;
                    }
                    return Err(failure.message);
                }
            };
            let page: PullResponse =
                serde_json::from_slice(&page).map_err(|error| error.to_string())?;
            pulled += page.changes.len();
            cursor = page.cursor;
            store
                .apply_pull(account_uuid, page.changes, cursor)
                .map_err(|error| format!("Applying pull page failed: {error}"))?;
            meter.item_done();
            if !page.has_more {
                break;
            }
        }
        // The server dealt with this build, so whatever it may once have
        // refused it accepts now. Said plainly here rather than left to
        // lapse, so a user who has installed the version that works does
        // not meet yesterday's bar on every launch.
        store.set_local_setting(COMPATIBILITY_KEY, "supported")?;
        // A successful sync is a complete offline replica: hydrate every PDF
        // and board file referenced by the account before reporting success.
        let missing = store.missing_blob_digests(account_uuid)?;
        meter.begin(SyncPhase::Downloading, Some(missing.len()));
        let files_url = if missing.is_empty() {
            None
        } else {
            self.files_url(&backend).await
        };
        for blob in missing {
            self.download_blob(
                store,
                &backend,
                files_url.as_deref(),
                token,
                &blob.sha256,
                blob.kind,
                &mut meter,
            )
            .await?;
            meter.item_done();
        }
        meter.finish();
        Ok(SyncResult {
            pushed,
            pulled,
            cursor,
        })
    }

    pub async fn ensure_blob(
        &self,
        store: &LocalStore,
        backend_url: &str,
        token: &str,
        sha256: &str,
        kind: BlobKind,
        report: &(dyn Fn(SyncProgress) + Send + Sync),
    ) -> Result<(), String> {
        let _guard = self.gate.lock().await;
        if token.trim().is_empty() {
            return Err("Downloading a file requires a signed-in account".into());
        }
        let backend = validated_backend(backend_url)?;
        let mut meter = Meter::new(report);
        meter.begin(SyncPhase::Downloading, Some(1));
        let files_url = self.files_url(&backend).await;
        self.download_blob(
            store,
            &backend,
            files_url.as_deref(),
            token,
            sha256,
            kind,
            &mut meter,
        )
        .await?;
        meter.item_done();
        meter.finish();
        Ok(())
    }

    /// Where the bytes of a file go: what the server answers when asked
    /// with the file's kind, digest, size, name and type. Either it holds
    /// them already, or here is a PUT to make, with these headers.
    #[allow(clippy::too_many_arguments)]
    async fn upload_address(
        &self,
        backend: &Url,
        token: &str,
        kind: BlobKind,
        sha256: &str,
        size: usize,
        name: &str,
        mime: &str,
    ) -> Result<UploadAddress, SyncFailure> {
        let url = backend
            .join("api/files/upload-address")
            .map_err(SyncFailure::transient)?;
        let body = serde_json::to_vec(&json!({
            "kind": kind.as_str(), "sha256": sha256, "size": size, "name": name, "mime": mime,
        }))
        .map_err(SyncFailure::permanent)?;
        let response = self
            .client
            .post(url)
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(SyncFailure::transient)?;
        if !response.status().is_success() {
            return Err(http_error(response).await);
        }
        let body = response.bytes().await.map_err(SyncFailure::transient)?;
        serde_json::from_slice(&body).map_err(SyncFailure::transient)
    }

    /// Where the files are, as the server says in its client requirements:
    /// the bucket's own address, from which every file is fetched with no
    /// Worker in the path — or nothing, when the Worker serves them itself
    /// (a local one), or could not be asked, in which case its routes are
    /// the way and send us on to the bucket anyway.
    async fn files_url(&self, backend: &Url) -> Option<String> {
        let url = backend.join("api/client-requirements").ok()?;
        let response = self.client.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let body: Value = response.json().await.ok()?;
        body.get("files_url")?
            .as_str()
            .map(|files| files.trim_end_matches('/').to_owned())
    }

    /// GETs a URL and reads the whole body, asking again when the
    /// connection dies mid-transfer. An HTTP status is the server's answer
    /// and is returned as it stands; only the transport gets second chances.
    /// The credential goes only where one is given: to Papol's routes, and
    /// never to the bucket.
    async fn fetch(
        &self,
        url: &Url,
        token: Option<&str>,
        meter: &mut Meter<'_>,
    ) -> Result<(Option<String>, Vec<u8>), SyncFailure> {
        let mut failure = None;
        for attempt in 0..TRANSFER_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(RETRY_PAUSE).await;
            }
            let mut request = self.client.get(url.clone());
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) => {
                    failure = Some(SyncFailure::transient(error));
                    continue;
                }
            };
            if !response.status().is_success() {
                return Err(http_error(response).await);
            }
            let mime = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            match read_body(response, meter).await {
                Ok(body) => return Ok((mime, body)),
                Err(error) => failure = Some(SyncFailure::transient(error)),
            }
        }
        Err(failure.expect("every attempt records its failure"))
    }

    /// One file into the local store: from the bucket's own address when
    /// there is one, by the key its kind names, with no credential — the
    /// files are public by key — or from the Worker's route by digest, with
    /// the credential, when the Worker serves its files itself.
    #[allow(clippy::too_many_arguments)]
    async fn download_blob(
        &self,
        store: &LocalStore,
        backend: &Url,
        files_url: Option<&str>,
        token: &str,
        sha256: &str,
        kind: BlobKind,
        meter: &mut Meter<'_>,
    ) -> Result<(), String> {
        let (url, credential) = match files_url {
            Some(files) => (
                Url::parse(&format!("{files}/{}", kind.key(sha256)))
                    .map_err(|error| error.to_string())?,
                None,
            ),
            None => (
                backend
                    .join(&format!("api/sync/blobs/{sha256}"))
                    .map_err(|error| error.to_string())?,
                Some(token),
            ),
        };
        let (mime, bytes) = self
            .fetch(&url, credential, meter)
            .await
            .map_err(|failure| failure.message)?;
        store.import_remote_blob(sha256, &bytes, mime)
    }
}

fn validated_backend(value: &str) -> Result<Url, String> {
    let normalized = format!("{}/", value.trim_end_matches('/'));
    let url = Url::parse(&normalized).map_err(|_| "Backend URL is invalid")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Backend must be an http or https origin without credentials".into());
    }
    Ok(url)
}

async fn http_error(response: reqwest::Response) -> SyncFailure {
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    let message = if detail.is_empty() {
        format!("Sync server returned {status}")
    } else {
        format!("Sync server returned {status}: {detail}")
    };
    SyncFailure {
        kind: classify_status(status.as_u16()),
        message,
    }
}

fn classify_status(status: u16) -> FailureKind {
    match status {
        // A payload rejected for size will not become valid by retrying it.
        // Block that one mutation so unrelated work can continue syncing.
        400 | 403 | 404 | 409 | 413 | 422 => FailureKind::Permanent,
        // Everything unrecognized is retried, so this has to be named
        // explicitly: left to the fallback, a build the server has stopped
        // speaking to would retry for as long as it was open, and its
        // user would never be told why nothing was arriving.
        426 => FailureKind::Incompatible,
        _ => FailureKind::Transient,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::DataChange;
    use serde_json::{json, Map};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use uuid::Uuid;

    #[test]
    fn a_build_the_server_refuses_is_not_retried_forever() {
        // The fallback arm retries, so an unnamed 426 would spin silently
        // for as long as the app stayed open.
        assert_eq!(FailureKind::Incompatible, classify_status(426));
        assert_eq!(FailureKind::Transient, classify_status(425));
        assert_eq!(FailureKind::Transient, classify_status(500));
        // And it is not one more rejected payload: the work is fine.
        assert_ne!(FailureKind::Permanent, classify_status(426));
    }

    #[test]
    fn backend_url_is_constrained_to_http_origins() {
        assert!(validated_backend("https://example.test/papol").is_ok());
        assert!(validated_backend("file:///tmp/server").is_err());
        assert!(validated_backend("https://user:secret@example.test").is_err());
    }

    #[test]
    fn backend_url_keeps_a_mounted_api_prefix_when_joining_sync_routes() {
        let backend = validated_backend("https://example.test/papol").unwrap();
        assert_eq!(
            backend.join("api/sync/snapshot").unwrap().as_str(),
            "https://example.test/papol/api/sync/snapshot",
        );
        let root = validated_backend("https://example.test").unwrap();
        assert_eq!(
            root.join("api/sync/snapshot").unwrap().as_str(),
            "https://example.test/api/sync/snapshot",
        );
    }

    #[test]
    fn progress_advances_through_phases_and_counts_bytes() {
        let reports = std::sync::Mutex::new(Vec::new());
        let record = |progress: SyncProgress| reports.lock().unwrap().push(progress);
        let mut meter = Meter::new(&record);
        meter.begin(SyncPhase::Uploading, Some(2));
        meter.item_done();
        meter.begin(SyncPhase::Downloading, Some(4));
        meter.transferred(1000, Some(0.5));
        meter.item_done();
        meter.begin(SyncPhase::Pulling, None);
        meter.finish();

        let reports = reports.into_inner().unwrap();
        let uploaded = &reports[1];
        assert_eq!(uploaded.completed, 1);
        assert_eq!(uploaded.fraction, 0.125);
        let downloaded = reports
            .iter()
            .find(|progress| progress.phase == SyncPhase::Downloading && progress.completed == 1)
            .unwrap();
        assert_eq!(downloaded.bytes, 1000);
        assert_eq!(downloaded.total, Some(4));
        assert_eq!(downloaded.fraction, 0.8125);
        assert!(reports
            .windows(2)
            .all(|pair| pair[0].fraction <= pair[1].fraction));
        assert_eq!(reports.last().unwrap().fraction, 1.0);
    }

    #[test]
    fn retryability_uses_structured_http_status_not_rendered_text() {
        assert_eq!(FailureKind::Permanent, classify_status(422));
        assert_eq!(FailureKind::Permanent, classify_status(403));
        assert_eq!(FailureKind::Permanent, classify_status(409));
        assert_eq!(FailureKind::Permanent, classify_status(413));
        assert_eq!(FailureKind::Transient, classify_status(503));
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 4096];
        let header_end = loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                return String::from_utf8_lossy(&bytes).into_owned();
            }
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(str::trim)
                    .map(str::to_owned)
            })
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        while bytes.len() < header_end + length {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn respond(stream: &mut TcpStream, body: &Value) {
        let body = body.to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body,
        ).unwrap();
    }

    /// Declares more bytes than it sends, then closes: the client's body
    /// read fails the way it does when a connection drops mid-transfer.
    fn respond_cut_short(stream: &mut TcpStream, body: &Value) {
        let body = body.to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len() + 7, body,
        ).unwrap();
    }

    #[tokio::test]
    async fn a_body_cut_mid_transfer_costs_one_attempt_not_the_sync() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                if request.starts_with("GET /api/sync/pull?") {
                    respond(
                        &mut stream,
                        &json!({"cursor": 1, "has_more": false, "changes": []}),
                    );
                } else if index == 0 {
                    respond_cut_short(&mut stream, &json!({"rows": []}));
                } else {
                    respond(&mut stream, &json!({"rows": []}));
                }
                requests.push(request);
            }
            requests
        });

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let coordinator = Coordinator::new().unwrap();
        let backend = format!("http://{address}");
        coordinator
            .synchronize(&store, "7", &backend, "token")
            .await
            .unwrap();

        let requests = server.join().unwrap();
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("GET /api/sync/snapshot "))
                .count(),
            2
        );
        assert!(requests
            .iter()
            .any(|request| request.starts_with("GET /api/sync/pull?")));
    }

    #[tokio::test]
    async fn a_refused_snapshot_records_the_incompatible_verdict() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            let body = json!({"detail": "Papol needs an update"}).to_string();
            write!(
                stream,
                "HTTP/1.1 426 Upgrade Required\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body,
            ).unwrap();
            request
        });

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        let coordinator = Coordinator::new().unwrap();
        let backend = format!("http://{address}");
        let error = coordinator
            .synchronize(&store, "7", &backend, "token")
            .await
            .unwrap_err();

        assert!(error.contains("426"));
        assert_eq!(
            store.local_setting(COMPATIBILITY_KEY).unwrap().as_deref(),
            Some("incompatible")
        );
        assert!(server
            .join()
            .unwrap()
            .starts_with("GET /api/sync/snapshot "));
    }

    #[tokio::test]
    async fn pull_only_reconciliation_leaves_pending_uploads_in_the_outbox() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                if request.starts_with("GET /api/sync/pull?") {
                    respond(
                        &mut stream,
                        &json!({"cursor": 1, "has_more": false, "changes": []}),
                    );
                } else {
                    respond(&mut stream, &json!({"rows": []}));
                }
                requests.push(request);
            }
            requests
        });

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "boards".into(),
                    uuid: Uuid::new_v4().to_string(),
                    operation: "upsert".into(),
                    values: Map::from_iter([("name".into(), json!("Pending upload"))]),
                }],
            )
            .unwrap();
        let coordinator = Coordinator::new().unwrap();
        let backend = format!("http://{address}");
        let report = |_: SyncProgress| {};
        let result = coordinator
            .synchronize_with_progress(
                &store,
                "7",
                &backend,
                "token",
                ReconcileOptions {
                    retry_blocked: false,
                    mode: SyncMode::Pull,
                },
                &report,
            )
            .await
            .unwrap();

        assert_eq!(result.pushed, 0);
        assert_eq!(
            store.query("7", "sync_status", json!({})).unwrap()["pending"],
            1
        );
        let requests = server.join().unwrap();
        assert!(requests
            .iter()
            .any(|request| request.starts_with("GET /api/sync/snapshot ")));
        assert!(requests
            .iter()
            .any(|request| request.starts_with("GET /api/sync/pull?")));
        assert!(!requests
            .iter()
            .any(|request| request.starts_with("POST /api/sync/push ")));
    }

    #[tokio::test]
    async fn ambiguous_push_is_retried_with_the_same_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let response_uuid = board_uuid.clone();
        let server = thread::spawn(move || {
            let (mut lost, _) = listener.accept().unwrap();
            let first = read_request(&mut lost);
            drop(lost);

            let (mut retry, _) = listener.accept().unwrap();
            let second = read_request(&mut retry);
            respond(
                &mut retry,
                &json!({
                    "rows": [{
                        "table": "boards", "uuid": response_uuid, "user_uuid": "7",
                        "shelf_uuid": null, "name": "Offline", "description": null,
                        "created_at": "2026-09-12T00:00:00Z",
                        "updated_at": "2026-09-12T00:00:00Z",
                        "revision": 1, "deleted_at": null
                    }],
                    "conflicts": []
                }),
            );

            let (mut retry_snapshot, _) = listener.accept().unwrap();
            let retry_snapshot_request = read_request(&mut retry_snapshot);
            respond(&mut retry_snapshot, &json!({"rows": []}));

            let (mut pull, _) = listener.accept().unwrap();
            let pull_request = read_request(&mut pull);
            respond(
                &mut pull,
                &json!({
                    "cursor": 1, "has_more": false, "changes": []
                }),
            );
            (first, retry_snapshot_request, second, pull_request)
        });

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "boards".into(),
                    uuid: board_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([("name".into(), json!("Offline"))]),
                }],
            )
            .unwrap();
        let coordinator = Coordinator::new().unwrap();
        let backend = format!("http://{address}");
        assert!(coordinator
            .synchronize(&store, "7", &backend, "token")
            .await
            .is_err());
        assert_eq!(
            store.query("7", "sync_status", json!({})).unwrap()["pending"],
            1
        );
        let failed_status = store.query("7", "sync_status", json!({})).unwrap();
        assert_eq!(failed_status["attempts"], 1);
        assert!(failed_status["outbox_error"].as_str().is_some());
        let result = coordinator
            .synchronize(&store, "7", &backend, "token")
            .await
            .unwrap();
        assert_eq!(result.pushed, 1);
        assert_eq!(
            store.query("7", "sync_status", json!({})).unwrap()["pending"],
            0
        );

        let (first, retry_snapshot, second, pull) = server.join().unwrap();
        assert!(retry_snapshot.starts_with("GET /api/sync/snapshot "));
        let first_body = first.split("\r\n\r\n").nth(1).unwrap();
        let second_body = second.split("\r\n\r\n").nth(1).unwrap();
        let first_json: Value = serde_json::from_str(first_body).unwrap();
        let second_json: Value = serde_json::from_str(second_body).unwrap();
        assert_eq!(first_json["mutation_uuid"], second_json["mutation_uuid"]);
        assert_eq!(first_json["client_uuid"], second_json["client_uuid"]);
        assert!(pull.starts_with("GET /api/sync/pull?"));
    }

    #[tokio::test]
    async fn simultaneous_windows_share_one_push_coordinator() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let board_uuid = Uuid::new_v4().to_string();
        let response_uuid = board_uuid.clone();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..5 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                if request.starts_with("POST /api/sync/push ") {
                    respond(
                        &mut stream,
                        &json!({
                            "rows": [{
                                "table": "boards", "uuid": response_uuid, "user_uuid": "7",
                                "shelf_uuid": null, "name": "One push", "description": null,
                                "created_at": "2026-09-12T00:00:00Z",
                                "updated_at": "2026-09-12T00:00:00Z",
                                "revision": 1, "deleted_at": null
                            }],
                            "conflicts": []
                        }),
                    );
                } else if request.starts_with("GET /api/sync/pull?") {
                    respond(
                        &mut stream,
                        &json!({"cursor": 1, "has_more": false, "changes": []}),
                    );
                } else {
                    respond(&mut stream, &json!({"rows": []}));
                }
                requests.push(request);
            }
            requests
        });

        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::open(&directory.path().join("papol.sqlite3")).unwrap();
        store
            .mutate(
                "7",
                vec![DataChange {
                    table: "boards".into(),
                    uuid: board_uuid,
                    operation: "upsert".into(),
                    values: Map::from_iter([("name".into(), json!("One push"))]),
                }],
            )
            .unwrap();
        let coordinator = Coordinator::new().unwrap();
        let backend = format!("http://{address}");
        let (first, second) = tokio::join!(
            coordinator.synchronize(&store, "7", &backend, "token"),
            coordinator.synchronize(&store, "7", &backend, "token"),
        );
        assert_eq!(first.unwrap().pushed + second.unwrap().pushed, 1);
        let requests = server.join().unwrap();
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("POST /api/sync/push "))
                .count(),
            1
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("GET /api/sync/pull?"))
                .count(),
            2
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.starts_with("GET /api/sync/snapshot "))
                .count(),
            2
        );
    }
}
