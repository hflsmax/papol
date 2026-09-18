use chrono::Utc;
use serde_json::{Map, Value};
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FILE_NAME: &str = "diagnostic.jsonl";
const MAX_BYTES: u64 = 1024 * 1024;
const FILE_COUNT: usize = 4;
const MAX_RECENT: usize = 200;
const ALLOWED_FIELDS: &[&str] = &[
    "backend_host",
    "blocked",
    "bytes",
    "completed",
    "conflicts",
    "duration_ms",
    "error_type",
    "operation",
    "pending",
    "phase",
    "pulled",
    "pushed",
    "status",
    "surface",
    "total",
    "version",
];

pub struct DiagnosticLog {
    directory: PathBuf,
    gate: Mutex<()>,
    max_bytes: u64,
    file_count: usize,
}

impl DiagnosticLog {
    pub fn new(app_data: &Path) -> Self {
        let directory = app_data.join("diagnostics");
        let _ = std::fs::create_dir_all(&directory);
        Self {
            directory,
            gate: Mutex::new(()),
            max_bytes: MAX_BYTES,
            file_count: FILE_COUNT,
        }
    }

    #[cfg(test)]
    fn for_test(directory: PathBuf, max_bytes: u64, file_count: usize) -> Self {
        std::fs::create_dir_all(&directory).unwrap();
        Self {
            directory,
            gate: Mutex::new(()),
            max_bytes,
            file_count,
        }
    }

    // Revealing the log directory is what the macOS "Show in Finder" menu
    // item needs, and nothing else asks. Gated with its one caller so that
    // a Linux clippy run does not report it as dead.
    #[cfg(target_os = "macos")]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    fn path(&self, generation: usize) -> PathBuf {
        if generation == 0 {
            self.directory.join(FILE_NAME)
        } else {
            self.directory.join(format!("{FILE_NAME}.{generation}"))
        }
    }

    fn rotate(&self) {
        let oldest = self.path(self.file_count - 1);
        if oldest.exists() {
            let _ = std::fs::remove_file(oldest);
        }
        for generation in (0..self.file_count - 1).rev() {
            let from = self.path(generation);
            if from.exists() {
                let _ = std::fs::rename(from, self.path(generation + 1));
            }
        }
    }

    pub fn record(
        &self,
        level: &str,
        component: &str,
        event: &str,
        message: Option<&str>,
        fields: Option<&Map<String, Value>>,
    ) -> Result<(), String> {
        let _guard = self.gate.lock().map_err(|_| "Diagnostic log lock failed")?;
        let mut entry = Map::from_iter([
            ("timestamp".into(), Value::String(Utc::now().to_rfc3339())),
            ("level".into(), Value::String(level.into())),
            ("component".into(), Value::String(identifier(component))),
            ("event".into(), Value::String(identifier(event))),
        ]);
        if let Some(message) = message {
            entry.insert("message".into(), Value::String(redact(message, 1200)));
        }
        let safe_fields = fields
            .into_iter()
            .flat_map(|fields| fields.iter())
            .filter(|(key, value)| {
                ALLOWED_FIELDS.contains(&key.as_str())
                    && matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
            })
            .take(16)
            .map(|(key, value)| {
                let value = match value {
                    Value::String(value) => Value::String(redact(value, 300)),
                    value => value.clone(),
                };
                (key.clone(), value)
            })
            .collect::<Map<_, _>>();
        if !safe_fields.is_empty() {
            entry.insert("fields".into(), Value::Object(safe_fields));
        }
        let mut encoded = serde_json::to_vec(&Value::Object(entry)).map_err(|e| e.to_string())?;
        encoded.push(b'\n');
        let current = self.path(0);
        let length = std::fs::metadata(&current).map_or(0, |metadata| metadata.len());
        if length > 0 && length + encoded.len() as u64 > self.max_bytes {
            self.rotate();
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(current)
            .map_err(|error| error.to_string())?;
        file.write_all(&encoded).map_err(|error| error.to_string())
    }

    pub fn recent(&self, limit: usize) -> Result<Vec<Value>, String> {
        let _guard = self.gate.lock().map_err(|_| "Diagnostic log lock failed")?;
        let limit = limit.clamp(1, MAX_RECENT);
        let mut events = VecDeque::with_capacity(limit);
        for generation in (0..self.file_count).rev() {
            let Ok(contents) = std::fs::read_to_string(self.path(generation)) else {
                continue;
            };
            for line in contents.lines() {
                let Ok(event) = serde_json::from_str(line) else {
                    continue;
                };
                if events.len() == limit {
                    events.pop_front();
                }
                events.push_back(event);
            }
        }
        Ok(events.into())
    }
}

fn identifier(value: &str) -> String {
    value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        .take(64)
        .collect()
}

fn redact(value: &str, limit: usize) -> String {
    let mut redacted = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(start) = remaining.find("/Users/") {
        let name_start = start + "/Users/".len();
        redacted.push_str(&remaining[..name_start]);
        redacted.push_str("<redacted>");
        let Some(relative_end) = remaining[name_start..].find('/') else {
            remaining = "";
            break;
        };
        remaining = &remaining[name_start + relative_end..];
    }
    redacted.push_str(remaining);
    let mut bearer_redacted = String::with_capacity(redacted.len());
    let mut remaining = redacted.as_str();
    while let Some(start) = remaining.to_ascii_lowercase().find("bearer ") {
        let token_start = start + "bearer ".len();
        bearer_redacted.push_str(&remaining[..token_start]);
        bearer_redacted.push_str("<redacted>");
        let token_end = remaining[token_start..]
            .find(char::is_whitespace)
            .map_or(remaining.len(), |offset| token_start + offset);
        remaining = &remaining[token_end..];
    }
    bearer_redacted.push_str(remaining);
    bearer_redacted.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn events_are_bounded_redacted_and_field_scoped() {
        let directory = tempfile::tempdir().unwrap();
        let log = DiagnosticLog::for_test(directory.path().join("logs"), 4096, 3);
        log.record(
            "error",
            "desktop/sync",
            "failed!",
            Some("could not read /Users/alice/private.pdf; Authorization: Bearer secret-token"),
            Some(&Map::from_iter([
                ("status".into(), json!(500)),
                ("document_text".into(), json!("secret")),
            ])),
        )
        .unwrap();
        let events = log.recent(10).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["component"], "desktopsync");
        assert_eq!(events[0]["event"], "failed");
        assert!(events[0]["message"]
            .as_str()
            .unwrap()
            .contains("<redacted>"));
        assert!(!events[0]["message"]
            .as_str()
            .unwrap()
            .contains("secret-token"));
        assert_eq!(events[0]["fields"]["status"], 500);
        assert!(events[0]["fields"].get("document_text").is_none());
        assert_eq!(
            redact("Bearer <redacted> /Users/<redacted>/file", 200),
            "Bearer <redacted> /Users/<redacted>/file"
        );
    }

    #[test]
    fn rotation_keeps_only_the_configured_generations() {
        let directory = tempfile::tempdir().unwrap();
        let log = DiagnosticLog::for_test(directory.path().join("logs"), 120, 3);
        for index in 0..12 {
            log.record(
                "info",
                "test",
                "event",
                Some(&format!("event {index}")),
                None,
            )
            .unwrap();
        }
        assert!(log.path(0).exists());
        assert!(log.path(1).exists());
        assert!(log.path(2).exists());
        assert!(!log.path(3).exists());
        assert!(log.recent(2).unwrap().len() <= 2);
    }
}
