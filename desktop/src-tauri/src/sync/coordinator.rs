use crate::data::{LocalStore, RemoteChange};
use crate::limits::value as app_limit;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FailureKind {
    Transient,
    Authentication,
    Permanent,
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
        let client = Client::builder()
            .user_agent("Papol Desktop/0.1")
            .connect_timeout(Duration::from_millis(app_limit(
                "timeouts_ms",
                "sync_connect",
            )))
            .read_timeout(Duration::from_millis(app_limit("timeouts_ms", "sync_read")))
            .timeout(Duration::from_millis(app_limit(
                "timeouts_ms",
                "sync_request",
            )))
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
        self.synchronize_with_progress(store, account_uuid, backend_url, token, &ignore)
            .await
    }

    pub async fn push_with_progress(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend_url: &str,
        token: &str,
        report: &(dyn Fn(SyncProgress) + Send + Sync),
    ) -> Result<SyncResult, String> {
        let _guard = self.gate.lock().await;
        let backend = validated_backend(backend_url)?;
        if token.trim().is_empty() {
            return Err("Sync requires a signed-in account".into());
        }
        let mut meter = Meter::new(report);
        let pushed = self
            .push_pending(store, account_uuid, &backend, token, &mut meter)
            .await?;
        meter.finish();
        Ok(SyncResult {
            pushed,
            pulled: 0,
            cursor: store.pull_cursor(account_uuid)?,
        })
    }

    async fn push_pending(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend: &Url,
        token: &str,
        meter: &mut Meter<'_>,
    ) -> Result<usize, String> {
        let outbox = store
            .query(account_uuid, "sync_status", serde_json::json!({}))?
            .get("pending")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        meter.begin(SyncPhase::Uploading, Some(outbox));
        let mut pushed = 0;
        while let Some(mutation) = store.next_outbox(account_uuid)? {
            let attempted: Result<PushResponse, SyncFailure> = async {
                for change in &mutation.changes {
                    let Some(sha256) = change.values.get("sha256").and_then(Value::as_str) else {
                        continue;
                    };
                    let url = backend
                        .join(&format!("api/sync/blobs/{sha256}"))
                        .map_err(SyncFailure::transient)?;
                    let present = self
                        .client
                        .head(url.clone())
                        .bearer_auth(token)
                        .send()
                        .await
                        .map_err(SyncFailure::transient)?;
                    if present.status() == reqwest::StatusCode::NOT_FOUND {
                        let bytes = store.read_blob(sha256).map_err(SyncFailure::permanent)?;
                        let size = bytes.len() as u64;
                        let mime = change
                            .values
                            .get("mime_type")
                            .and_then(Value::as_str)
                            .unwrap_or("application/octet-stream");
                        let uploaded = self
                            .client
                            .put(url)
                            .bearer_auth(token)
                            .header(reqwest::header::CONTENT_TYPE, mime)
                            .body(bytes)
                            .send()
                            .await
                            .map_err(SyncFailure::transient)?;
                        if !uploaded.status().is_success() {
                            return Err(http_error(uploaded).await);
                        }
                        meter.transferred(size, None);
                    } else if !present.status().is_success() {
                        return Err(http_error(present).await);
                    }
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

    pub async fn synchronize_with_progress(
        &self,
        store: &LocalStore,
        account_uuid: &str,
        backend_url: &str,
        token: &str,
        report: &(dyn Fn(SyncProgress) + Send + Sync),
    ) -> Result<SyncResult, String> {
        let _guard = self.gate.lock().await;
        let backend = validated_backend(backend_url)?;
        if token.trim().is_empty() {
            return Err("Sync requires a signed-in account".into());
        }
        let mut meter = Meter::new(report);
        let pushed = self
            .push_pending(store, account_uuid, &backend, token, &mut meter)
            .await?;

        // Push first so aliases can collapse a temporary offline import
        // before a snapshot introduces the same paper or edition UUID.
        meter.begin(SyncPhase::Snapshot, Some(1));
        let snapshot_url = backend
            .join("api/sync/snapshot")
            .map_err(|error| error.to_string())?;
        let snapshot_response = self
            .client
            .get(snapshot_url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !snapshot_response.status().is_success() {
            return Err(http_error(snapshot_response).await.message);
        }
        let snapshot = read_body(snapshot_response, &mut meter)
            .await
            .map_err(|error| error.to_string())?;
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
            let response = self
                .client
                .get(url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|error| error.to_string())?;
            if !response.status().is_success() {
                return Err(http_error(response).await.message);
            }
            let page = read_body(response, &mut meter)
                .await
                .map_err(|error| error.to_string())?;
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
        // A successful sync is a complete offline replica: hydrate every PDF
        // and board file referenced by the account before reporting success.
        let missing = store.missing_blob_digests(account_uuid)?;
        meter.begin(SyncPhase::Downloading, Some(missing.len()));
        for sha256 in missing {
            self.download_blob(store, backend_url, token, &sha256, &mut meter)
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
    ) -> Result<(), String> {
        let _guard = self.gate.lock().await;
        let ignore = |_: SyncProgress| {};
        self.download_blob(store, backend_url, token, sha256, &mut Meter::new(&ignore))
            .await
    }

    async fn download_blob(
        &self,
        store: &LocalStore,
        backend_url: &str,
        token: &str,
        sha256: &str,
        meter: &mut Meter<'_>,
    ) -> Result<(), String> {
        if store.has_blob(sha256) {
            return Ok(());
        }
        if token.trim().is_empty() {
            return Err("Downloading a file requires a signed-in account".into());
        }
        if sha256.len() != 64
            || !sha256
                .chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
        {
            return Err("Invalid blob identifier".into());
        }
        let backend = validated_backend(backend_url)?;
        let url = backend
            .join(&format!("api/sync/blobs/{sha256}"))
            .map_err(|error| error.to_string())?;
        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(http_error(response).await.message);
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = read_body(response, meter)
            .await
            .map_err(|error| error.to_string())?;
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
        401 => FailureKind::Authentication,
        // A payload rejected for size will not become valid by retrying it.
        // Block that one mutation so unrelated work can continue syncing.
        400 | 403 | 404 | 409 | 413 | 422 => FailureKind::Permanent,
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
        assert_eq!(FailureKind::Authentication, classify_status(401));
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
