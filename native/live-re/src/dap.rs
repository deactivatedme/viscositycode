//! Debug Adapter Protocol client: `Content-Length` framing, request/response
//! matching by `seq`, per-request timeouts, and bounded event buffering.

use serde_json::{Value, json};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

/// Buffered stdout/stderr/console text kept per session.
pub const MAX_OUTPUT_BUFFER: usize = 2 * 1024 * 1024;
/// Largest DAP message body accepted from the adapter.
pub const MAX_DAP_BODY: usize = 32 * 1024 * 1024;
/// Stop/exit events kept until `re_wait` consumes them.
pub const MAX_RUN_EVENTS: usize = 64;
/// Distinct breakpoint ids whose events wait for the session to read them.
pub const MAX_BREAKPOINT_EVENTS: usize = 4096;

pub fn encode_message(message: &Value) -> Vec<u8> {
    let body = message.to_string();
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

/// Incremental `Content-Length` frame decoder.
#[derive(Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
}

impl FrameDecoder {
    pub fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
    }

    /// Next complete message, `Ok(None)` when more bytes are needed.
    pub fn next_message(&mut self) -> Result<Option<Value>, String> {
        let Some(header_end) = self.buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            if self.buf.len() > 8 * 1024 {
                return Err("DAP header too long".into());
            }
            return Ok(None);
        };
        let header = String::from_utf8_lossy(&self.buf[..header_end]);
        let mut length = None;
        for line in header.split("\r\n") {
            if let Some((name, value)) = line.split_once(':')
                && name.trim().eq_ignore_ascii_case("content-length")
            {
                length = value.trim().parse::<usize>().ok();
            }
        }
        let length = length.ok_or("DAP header without a valid Content-Length")?;
        if length > MAX_DAP_BODY {
            return Err(format!("DAP message of {length} bytes exceeds the limit"));
        }
        let start = header_end + 4;
        if self.buf.len() < start + length {
            return Ok(None);
        }
        let parsed = serde_json::from_slice(&self.buf[start..start + length]);
        self.buf.drain(..start + length);
        parsed
            .map(Some)
            .map_err(|e| format!("invalid DAP JSON: {e}"))
    }
}

#[derive(Clone, Debug)]
pub struct OutputChunk {
    pub seq: u64,
    pub category: String,
    pub text: String,
}

/// Ring of output text capped at `MAX_OUTPUT_BUFFER` bytes; oldest drops first.
#[derive(Default)]
pub struct OutputBuffer {
    chunks: VecDeque<OutputChunk>,
    bytes: usize,
    next_seq: u64,
    pub dropped_bytes: u64,
}

pub fn truncate_at_char(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

impl OutputBuffer {
    pub fn push(&mut self, category: &str, text: &str) {
        let text = truncate_at_char(text, MAX_OUTPUT_BUFFER);
        while self.bytes + text.len() > MAX_OUTPUT_BUFFER {
            let Some(old) = self.chunks.pop_front() else {
                break;
            };
            self.bytes -= old.text.len();
            self.dropped_bytes += old.text.len() as u64;
        }
        self.next_seq += 1;
        self.bytes += text.len();
        self.chunks.push_back(OutputChunk {
            seq: self.next_seq,
            category: category.to_string(),
            text: text.to_string(),
        });
    }

    /// Chunks after `since`, at most `max_bytes` of text. Returns
    /// `(chunks, more)`; an oversized first chunk is truncated, not skipped.
    pub fn read_since(&self, since: u64, max_bytes: usize) -> (Vec<OutputChunk>, bool) {
        let mut out = Vec::new();
        let mut used = 0;
        for chunk in self.chunks.iter().filter(|c| c.seq > since) {
            if used + chunk.text.len() > max_bytes {
                if out.is_empty() {
                    let mut cut = chunk.clone();
                    cut.text = truncate_at_char(&chunk.text, max_bytes).to_string();
                    out.push(cut);
                }
                return (out, true);
            }
            used += chunk.text.len();
            out.push(chunk.clone());
        }
        (out, false)
    }

    pub fn last_seq(&self) -> u64 {
        self.next_seq
    }
}

/// Adapter-side state the reader thread maintains from responses and events.
#[derive(Default)]
pub struct DapState {
    pending: HashSet<i64>,
    responses: HashMap<i64, Value>,
    pub initialized: bool,
    pub closed: bool,
    pub close_reason: Option<String>,
    /// `running`, `stopped`, `exited`, `terminated` or empty before launch.
    pub run_state: String,
    pub last_stop: Option<Value>,
    pub exit_code: Option<i64>,
    pub process_id: Option<i64>,
    pub run_events: VecDeque<Value>,
    /// Latest `breakpoint` event object per adapter breakpoint id, until the
    /// session folds it into its list.
    pub breakpoint_events: HashMap<i64, Value>,
    pub output: OutputBuffer,
}

impl DapState {
    pub fn has_response(&self, seq: i64) -> bool {
        self.responses.contains_key(&seq)
    }

    fn push_run_event(&mut self, event: Value) {
        if self.run_events.len() >= MAX_RUN_EVENTS {
            self.run_events.pop_front();
        }
        self.run_events.push_back(event);
    }
}

struct Shared {
    writer: Mutex<Box<dyn Write + Send>>,
    state: Mutex<DapState>,
    cond: Condvar,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    fn write(&self, message: &Value) -> io::Result<()> {
        let mut writer = lock(&self.writer);
        writer.write_all(&encode_message(message))?;
        writer.flush()
    }

    fn handle(&self, message: Value) {
        match message.get("type").and_then(Value::as_str) {
            Some("response") => {
                let Some(seq) = message.get("request_seq").and_then(Value::as_i64) else {
                    return;
                };
                let mut state = lock(&self.state);
                if state.pending.contains(&seq) {
                    state.responses.insert(seq, message);
                    self.cond.notify_all();
                }
            }
            Some("event") => self.handle_event(&message),
            Some("request") => {
                // Reverse requests (runInTerminal, startDebugging) are never
                // advertised, so refuse any the adapter sends anyway.
                let reply = json!({
                    "type": "response",
                    "seq": 0,
                    "request_seq": message.get("seq").cloned().unwrap_or(Value::Null),
                    "command": message.get("command").cloned().unwrap_or(Value::Null),
                    "success": false,
                    "message": "not supported by viscosity-live-re",
                });
                let _ = self.write(&reply);
            }
            _ => {}
        }
    }

    fn handle_event(&self, message: &Value) {
        let event = message.get("event").and_then(Value::as_str).unwrap_or("");
        let body = message.get("body").cloned().unwrap_or(Value::Null);
        let mut state = lock(&self.state);
        match event {
            "initialized" => state.initialized = true,
            "output" => {
                let category = body.get("category").and_then(Value::as_str);
                let text = body.get("output").and_then(Value::as_str).unwrap_or("");
                // `telemetry` is adapter-internal noise.
                if category != Some("telemetry") && !text.is_empty() {
                    state.output.push(category.unwrap_or("console"), text);
                }
            }
            "process" => {
                state.process_id = body.get("systemProcessId").and_then(Value::as_i64);
            }
            "continued" => state.run_state = "running".into(),
            "breakpoint" => {
                let reason = body.get("reason").and_then(Value::as_str);
                let breakpoint = body.get("breakpoint").cloned().unwrap_or(Value::Null);
                if let Some(id) = breakpoint.get("id").and_then(Value::as_i64) {
                    if reason == Some("removed") {
                        state.breakpoint_events.remove(&id);
                    } else if state.breakpoint_events.len() < MAX_BREAKPOINT_EVENTS
                        || state.breakpoint_events.contains_key(&id)
                    {
                        state.breakpoint_events.insert(id, breakpoint);
                    }
                }
            }
            "stopped" => {
                state.run_state = "stopped".into();
                state.last_stop = Some(body.clone());
                state.push_run_event(json!({"event": "stopped", "body": body}));
            }
            "exited" => {
                state.run_state = "exited".into();
                state.exit_code = body.get("exitCode").and_then(Value::as_i64);
                state.push_run_event(json!({"event": "exited", "body": body}));
            }
            "terminated" => {
                if state.run_state != "exited" {
                    state.run_state = "terminated".into();
                }
                state.push_run_event(json!({"event": "terminated", "body": body}));
            }
            _ => return,
        }
        self.cond.notify_all();
    }

    fn close(&self, reason: String) {
        let mut state = lock(&self.state);
        if !state.closed {
            state.closed = true;
            state.close_reason = Some(reason);
        }
        self.cond.notify_all();
    }
}

/// One debug adapter connection (normally an owned `lldb-dap` child).
pub struct DapClient {
    shared: Arc<Shared>,
    seq: AtomicI64,
    child: Mutex<Option<Child>>,
}

#[cfg(unix)]
fn reset_signal_mask(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: only async-signal-safe libc calls run in the forked child. This
    // undoes the SIGINT/SIGTERM mask main() installs for its sigwait thread.
    unsafe {
        command.pre_exec(|| {
            let mut empty: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut empty);
            libc::pthread_sigmask(libc::SIG_SETMASK, &empty, std::ptr::null_mut());
            Ok(())
        });
    }
}

impl DapClient {
    /// Connects over arbitrary streams; used by tests with an in-process fake.
    pub fn from_streams<R, W>(reader: R, writer: W) -> Self
    where
        R: Read + Send + 'static,
        W: Write + Send + 'static,
    {
        let shared = Arc::new(Shared {
            writer: Mutex::new(Box::new(writer)),
            state: Mutex::new(DapState::default()),
            cond: Condvar::new(),
        });
        let reader_shared = Arc::clone(&shared);
        thread::spawn(move || read_loop(reader, &reader_shared));
        Self {
            shared,
            seq: AtomicI64::new(1),
            child: Mutex::new(None),
        }
    }

    pub fn spawn(program: &Path) -> io::Result<Self> {
        let mut command = Command::new(program);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        reset_signal_mask(&mut command);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            return Err(io::Error::other("failed to capture lldb-dap stdio"));
        };
        let stderr = child.stderr.take();
        let client = Self::from_streams(stdout, stdin);
        if let Some(mut stderr) = stderr {
            let shared = Arc::clone(&client.shared);
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while let Ok(n) = stderr.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    lock(&shared.state).output.push("adapter-stderr", &text);
                }
            });
        }
        *lock(&client.child) = Some(child);
        Ok(client)
    }

    /// Sends a request and returns its `seq` without waiting.
    pub fn send(&self, command: &str, arguments: Value) -> Result<i64, String> {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        {
            let mut state = lock(&self.shared.state);
            if state.closed {
                return Err(closed_message(&state));
            }
            state.pending.insert(seq);
        }
        let message =
            json!({"seq": seq, "type": "request", "command": command, "arguments": arguments});
        if let Err(error) = self.shared.write(&message) {
            lock(&self.shared.state).pending.remove(&seq);
            self.shared.close(format!("write failed: {error}"));
            return Err(format!("debug adapter write failed: {error}"));
        }
        Ok(seq)
    }

    /// True once the response for `seq` arrived (it stays claimable).
    pub fn has_response(&self, seq: i64) -> bool {
        lock(&self.shared.state).responses.contains_key(&seq)
    }

    /// Waits for the response to `seq`; returns its body on success.
    pub fn wait_response(&self, seq: i64, timeout: Duration) -> Result<Value, String> {
        let deadline = Instant::now() + timeout;
        let mut state = lock(&self.shared.state);
        loop {
            if let Some(response) = state.responses.remove(&seq) {
                state.pending.remove(&seq);
                return response_body(response);
            }
            if state.closed {
                state.pending.remove(&seq);
                return Err(closed_message(&state));
            }
            let now = Instant::now();
            if now >= deadline {
                state.pending.remove(&seq);
                return Err(format!(
                    "debug adapter did not answer within {} ms",
                    timeout.as_millis()
                ));
            }
            state = self
                .shared
                .cond
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    pub fn request(
        &self,
        command: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let seq = self.send(command, arguments)?;
        self.wait_response(seq, timeout)
    }

    /// Blocks until `ready(state)`, the adapter closes, or `timeout` passes;
    /// returns whether `ready` held.
    pub fn wait_until(&self, timeout: Duration, ready: impl Fn(&DapState) -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = lock(&self.shared.state);
        loop {
            if ready(&state) {
                return true;
            }
            let now = Instant::now();
            if state.closed || now >= deadline {
                return false;
            }
            state = self
                .shared
                .cond
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    /// Runs `f` with the locked adapter state.
    pub fn with_state<T>(&self, f: impl FnOnce(&mut DapState) -> T) -> T {
        f(&mut lock(&self.shared.state))
    }

    /// Kills the adapter child (if any) and marks the connection closed.
    pub fn close(&self) {
        self.shared.close("session closed".into());
        // Dropping the pipe gives lldb-dap stdin EOF.
        *lock(&self.shared.writer) = Box::new(io::sink());
        if let Some(mut child) = lock(&self.child).take() {
            // Give lldb-dap a moment to exit on EOF; kill it if it lingers.
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                thread::sleep(Duration::from_millis(10));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for DapClient {
    fn drop(&mut self) {
        self.close();
    }
}

fn closed_message(state: &DapState) -> String {
    format!(
        "debug adapter closed ({})",
        state.close_reason.as_deref().unwrap_or("unknown reason")
    )
}

fn response_body(response: Value) -> Result<Value, String> {
    if response.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(response.get("body").cloned().unwrap_or(Value::Null));
    }
    let command = response
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("request");
    let mut message = response
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("failed")
        .to_string();
    if let Some(detail) = response
        .pointer("/body/error/format")
        .and_then(Value::as_str)
    {
        message = if message == "failed" || message.is_empty() {
            detail.to_string()
        } else {
            format!("{message}: {detail}")
        };
    }
    Err(format!("{command} failed: {message}"))
}

fn read_loop<R: Read>(mut reader: R, shared: &Shared) {
    let mut decoder = FrameDecoder::default();
    let mut buf = [0u8; 64 * 1024];
    let reason = loop {
        match reader.read(&mut buf) {
            Ok(0) => break "adapter exited".to_string(),
            Ok(n) => {
                decoder.push(&buf[..n]);
                loop {
                    match decoder.next_message() {
                        Ok(Some(message)) => shared.handle(message),
                        Ok(None) => break,
                        Err(error) => {
                            shared.close(error);
                            return;
                        }
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => break format!("read failed: {error}"),
        }
    };
    shared.close(reason);
}

/// In-process fake adapter shared by unit tests: reads requests and lets the
/// test script replies and events.
#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
pub(crate) mod fake {
    use super::*;
    use std::io::{PipeReader, PipeWriter, pipe};

    pub struct Fake {
        from_client: PipeReader,
        to_client: PipeWriter,
        decoder: FrameDecoder,
    }

    impl Fake {
        pub fn next_request(&mut self) -> Value {
            let mut buf = [0u8; 4096];
            loop {
                if let Some(message) = self.decoder.next_message().unwrap() {
                    return message;
                }
                let n = self.from_client.read(&mut buf).unwrap();
                assert!(n > 0, "client closed");
                self.decoder.push(&buf[..n]);
            }
        }

        pub fn send(&mut self, message: Value) {
            self.to_client.write_all(&encode_message(&message)).unwrap();
        }

        pub fn reply(&mut self, request: &Value, body: Value) {
            self.send(json!({
                "seq": 0, "type": "response", "request_seq": request["seq"],
                "command": request["command"], "success": true, "body": body,
            }));
        }

        pub fn event(&mut self, event: &str, body: Value) {
            self.send(json!({"seq": 0, "type": "event", "event": event, "body": body}));
        }
    }

    pub fn connect() -> (DapClient, Fake) {
        let (client_read, fake_write) = pipe().unwrap();
        let (fake_read, client_write) = pipe().unwrap();
        let client = DapClient::from_streams(client_read, client_write);
        let fake = Fake {
            from_client: fake_read,
            to_client: fake_write,
            decoder: FrameDecoder::default(),
        };
        (client, fake)
    }
}

#[cfg(test)]
mod tests {
    use super::fake::connect;
    use super::*;

    #[test]
    fn decodes_frames_split_across_chunks() {
        let a = encode_message(&json!({"seq": 1, "type": "event", "event": "x"}));
        let b = encode_message(&json!({"seq": 2, "type": "event", "event": "é"}));
        let all = [a, b].concat();
        let mut decoder = FrameDecoder::default();
        let mut got = Vec::new();
        for byte in all {
            decoder.push(&[byte]);
            while let Some(message) = decoder.next_message().unwrap() {
                got.push(message);
            }
        }
        assert_eq!(got.len(), 2);
        assert_eq!(got[1]["event"], "é");
    }

    #[test]
    fn rejects_missing_or_huge_content_length() {
        let mut decoder = FrameDecoder::default();
        decoder.push(b"X-Other: 1\r\n\r\n{}");
        assert!(decoder.next_message().is_err());
        let mut decoder = FrameDecoder::default();
        decoder.push(format!("Content-Length: {}\r\n\r\n", MAX_DAP_BODY + 1).as_bytes());
        assert!(decoder.next_message().is_err());
    }

    #[test]
    fn output_buffer_caps_and_pages() {
        let mut buffer = OutputBuffer::default();
        let big = "x".repeat(MAX_OUTPUT_BUFFER / 2 + 1);
        buffer.push("stdout", &big);
        buffer.push("stdout", &big);
        buffer.push("stderr", "tail");
        assert!(buffer.dropped_bytes > 0);
        assert!(buffer.bytes <= MAX_OUTPUT_BUFFER);
        let (chunks, more) = buffer.read_since(0, 64 * 1024);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text.len(), 64 * 1024);
        assert!(more);
        let (chunks, more) = buffer.read_since(2, 64 * 1024);
        assert_eq!(chunks[0].text, "tail");
        assert!(!more);
    }

    #[test]
    fn matches_out_of_order_responses_by_seq() {
        let (client, mut fake) = connect();
        let first = client.send("threads", json!({})).unwrap();
        let second = client.send("modules", json!({})).unwrap();
        let r1 = fake.next_request();
        let r2 = fake.next_request();
        assert_eq!(r1["command"], "threads");
        fake.reply(&r2, json!({"which": "modules"}));
        fake.reply(&r1, json!({"which": "threads"}));
        let timeout = Duration::from_secs(2);
        assert_eq!(
            client.wait_response(first, timeout).unwrap()["which"],
            "threads"
        );
        assert_eq!(
            client.wait_response(second, timeout).unwrap()["which"],
            "modules"
        );
    }

    #[test]
    fn failed_response_becomes_error_message() {
        let (client, mut fake) = connect();
        let seq = client.send("evaluate", json!({})).unwrap();
        let request = fake.next_request();
        fake.send(json!({
            "seq": 0, "type": "response", "request_seq": request["seq"], "command": "evaluate",
            "success": false, "message": "boom", "body": {"error": {"format": "detail"}},
        }));
        let error = client
            .wait_response(seq, Duration::from_secs(2))
            .unwrap_err();
        assert_eq!(error, "evaluate failed: boom: detail");
    }

    #[test]
    fn request_times_out_and_late_reply_is_dropped() {
        let (client, mut fake) = connect();
        let error = client
            .request("pause", json!({}), Duration::from_millis(50))
            .unwrap_err();
        assert!(error.contains("did not answer"));
        let request = fake.next_request();
        fake.reply(&request, json!({}));
        thread::sleep(Duration::from_millis(50));
        assert!(client.with_state(|s| s.responses.is_empty() && s.pending.is_empty()));
    }

    #[test]
    fn buffers_events_and_refuses_reverse_requests() {
        let (client, mut fake) = connect();
        fake.send(json!({"seq": 1, "type": "event", "event": "output",
            "body": {"category": "stdout", "output": "hi\n"}}));
        fake.send(json!({"seq": 2, "type": "event", "event": "output",
            "body": {"category": "telemetry", "output": "x"}}));
        fake.send(json!({"seq": 3, "type": "event", "event": "stopped",
            "body": {"reason": "breakpoint", "threadId": 7}}));
        fake.send(
            json!({"seq": 4, "type": "request", "command": "runInTerminal", "arguments": {}}),
        );
        assert!(client.wait_until(Duration::from_secs(2), |s| !s.run_events.is_empty()));
        let refusal = fake.next_request();
        assert_eq!(refusal["type"], "response");
        assert_eq!(refusal["success"], false);
        client.with_state(|s| {
            assert_eq!(s.run_state, "stopped");
            assert_eq!(s.last_stop.as_ref().unwrap()["threadId"], 7);
            let (chunks, _) = s.output.read_since(0, 1024);
            assert_eq!(chunks.len(), 1);
            assert_eq!(chunks[0].text, "hi\n");
        });
    }

    #[test]
    fn adapter_eof_fails_pending_requests() {
        let (client, fake) = connect();
        let seq = client.send("threads", json!({})).unwrap();
        drop(fake);
        let error = client
            .wait_response(seq, Duration::from_secs(2))
            .unwrap_err();
        assert!(error.contains("closed"));
        assert!(client.send("threads", json!({})).is_err());
    }

    #[test]
    fn buffers_latest_breakpoint_event_per_id() {
        let (client, mut fake) = connect();
        fake.event(
            "breakpoint",
            json!({"reason": "changed", "breakpoint": {"id": 3, "verified": false}}),
        );
        fake.event(
            "breakpoint",
            json!({"reason": "changed", "breakpoint": {"id": 3, "verified": true}}),
        );
        fake.event(
            "breakpoint",
            json!({"reason": "new", "breakpoint": {"id": 4, "verified": true}}),
        );
        fake.event(
            "breakpoint",
            json!({"reason": "removed", "breakpoint": {"id": 4}}),
        );
        fake.event("stopped", json!({"reason": "pause", "threadId": 1}));
        assert!(client.wait_until(Duration::from_secs(2), |s| !s.run_events.is_empty()));
        client.with_state(|s| {
            assert_eq!(s.breakpoint_events.len(), 1);
            assert_eq!(s.breakpoint_events[&3]["verified"], true);
        });
    }
}
