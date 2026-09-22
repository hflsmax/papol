//! A stand-in for the sync server, for tests that drive the coordinator
//! over real HTTP.
//!
//! The earlier servers accepted an exact number of connections and were
//! then joined, so a regression that sent one request fewer hung the suite
//! instead of failing it. This one answers whatever arrives by a route
//! table, keeps every request for the test to inspect afterwards, stops
//! accepting at a deadline of its own, and stops when dropped. Nothing
//! waits on it, so what a test asserts is what the client actually sent.

use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// How long any one test may run before it counts as hung. Generous next
/// to what the tests need — the slowest waits out one second of retry
/// pause — so it only ever trips on a real hang.
const TEST_LIMIT: Duration = Duration::from_secs(20);
/// The server outlives the test's own limit, so a test sees its hang
/// reported as a hang rather than as a refused connection.
const ACCEPT_LIMIT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(5);
/// A client that connects and never finishes its request cannot keep a
/// connection thread alive past this.
const READ_LIMIT: Duration = Duration::from_secs(5);

/// Runs a test body and fails it, rather than the whole suite hanging,
/// when it does not finish in time.
pub(crate) async fn bounded<F: Future>(body: F) -> F::Output {
    tokio::time::timeout(TEST_LIMIT, body)
        .await
        .unwrap_or_else(|_| panic!("the test did not finish within {TEST_LIMIT:?}"))
}

/// One request as the server read it.
#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub method: String,
    /// The path without its query string, which is what routes match.
    pub path: String,
    pub query: Option<String>,
    /// Names lowercased, since HTTP does not care and assertions should not.
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn is(&self, method: &str, path: &str) -> bool {
        self.method == method && self.path == path
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }

    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|error| {
            panic!("{} {} did not carry JSON: {error}", self.method, self.path)
        })
    }
}

/// What the server does with a request.
#[derive(Debug, Clone)]
pub(crate) enum Reply {
    Respond {
        status: u16,
        body: Vec<u8>,
    },
    /// Declares more bytes than it sends, then closes: the client's body
    /// read fails the way it does when a connection drops mid-transfer.
    CutShort(Vec<u8>),
    /// Reads the request and closes without answering, as a connection
    /// lost after the server may already have acted on it.
    Hangup,
}

impl Reply {
    pub fn json(status: u16, body: Value) -> Self {
        Reply::Respond {
            status,
            body: body.to_string().into_bytes(),
        }
    }

    pub fn ok(body: Value) -> Self {
        Reply::json(200, body)
    }

    pub fn cut_short(body: Value) -> Self {
        Reply::CutShort(body.to_string().into_bytes())
    }
}

type Handler = Box<dyn FnMut(&Request) -> Reply + Send>;

struct Route {
    method: String,
    path: String,
    handler: Handler,
}

#[derive(Default)]
struct State {
    routes: Vec<Route>,
    requests: Vec<Request>,
}

pub(crate) struct FakeServer {
    address: SocketAddr,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    acceptor: Option<JoinHandle<()>>,
}

impl FakeServer {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        // Non-blocking, so the loop can notice the stop flag and its own
        // deadline instead of waiting in accept for a client that never
        // comes.
        listener.set_nonblocking(true).unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let acceptor = {
            let state = Arc::clone(&state);
            let stop = Arc::clone(&stop);
            thread::spawn(move || {
                let deadline = Instant::now() + ACCEPT_LIMIT;
                while !stop.load(Ordering::SeqCst) && Instant::now() < deadline {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            // One thread per connection: simultaneous
                            // requests must not queue behind each other
                            // here when the client would not queue them.
                            let state = Arc::clone(&state);
                            thread::spawn(move || serve(stream, &state));
                        }
                        Err(error) if error.kind() == ErrorKind::WouldBlock => {
                            thread::sleep(POLL_INTERVAL);
                        }
                        Err(error) => panic!("the fake server stopped accepting: {error}"),
                    }
                }
            })
        };
        Self {
            address,
            state,
            stop,
            acceptor: Some(acceptor),
        }
    }

    /// The backend URL to hand the coordinator.
    pub fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// Answers `method path` by calling `handler` with each request. A
    /// later route for the same method and path replaces an earlier one.
    pub fn route(
        &self,
        method: &str,
        path: &str,
        handler: impl FnMut(&Request) -> Reply + Send + 'static,
    ) -> &Self {
        let mut state = self.state.lock().unwrap();
        state
            .routes
            .retain(|route| !(route.method == method && route.path == path));
        state.routes.push(Route {
            method: method.into(),
            path: path.into(),
            handler: Box::new(handler),
        });
        self
    }

    /// Answers `method path` with the same reply every time.
    pub fn reply(&self, method: &str, path: &str, reply: Reply) -> &Self {
        self.route(method, path, move |_| reply.clone())
    }

    /// Answers `method path` with these replies in turn, the last one
    /// standing for every request after it.
    pub fn replies(&self, method: &str, path: &str, replies: Vec<Reply>) -> &Self {
        assert!(!replies.is_empty(), "a sequence needs at least one reply");
        let mut replies = replies.into_iter();
        let mut last = None;
        self.route(method, path, move |_| {
            if let Some(reply) = replies.next() {
                last = Some(reply);
            }
            last.clone().unwrap()
        })
    }

    /// Every request received so far, in the order they arrived.
    pub fn requests(&self) -> Vec<Request> {
        self.state.lock().unwrap().requests.clone()
    }

    /// Every request for `method path` received so far.
    pub fn requests_to(&self, method: &str, path: &str) -> Vec<Request> {
        self.requests()
            .into_iter()
            .filter(|request| request.is(method, path))
            .collect()
    }

    pub fn count(&self, method: &str, path: &str) -> usize {
        self.requests_to(method, path).len()
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(acceptor) = self.acceptor.take() {
            // A panic in the acceptor is already reported; a second one
            // here while a failed test unwinds would abort the run.
            let _ = acceptor.join();
        }
    }
}

fn serve(mut stream: TcpStream, state: &Mutex<State>) {
    // Accepted sockets can inherit the listener's non-blocking mode.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_LIMIT));
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    // Recorded before answering, so a client that has its answer can rely
    // on the request being there to assert on.
    let reply = {
        let mut state = state.lock().unwrap();
        state.requests.push(request.clone());
        match state
            .routes
            .iter_mut()
            .find(|route| request.is(&route.method, &route.path))
        {
            Some(route) => (route.handler)(&request),
            None => Reply::Respond {
                status: 404,
                body: format!(
                    "the fake server has no route for {} {}",
                    request.method, request.path
                )
                .into_bytes(),
            },
        }
    };
    let (status, body, declared) = match reply {
        Reply::Hangup => return,
        Reply::Respond { status, body } => {
            let length = body.len();
            (status, body, length)
        }
        Reply::CutShort(body) => {
            let length = body.len() + 7;
            (200, body, length)
        }
    };
    let reason = reqwest::StatusCode::from_u16(status)
        .ok()
        .and_then(|status| status.canonical_reason())
        .unwrap_or("Status");
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n"
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let head = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut start = lines.next()?.split(' ');
    let method = start.next()?.to_owned();
    let target = start.next()?;
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_owned(), Some(query.to_owned())),
        None => (target.to_owned(), None),
    };
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    let length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() < header_end + length {
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Some(Request {
        method,
        path,
        query,
        headers,
        body: bytes[header_end..].to_vec(),
    })
}
