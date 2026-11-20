//! Debug sessions: one lldb-dap child per session, launch/attach handshake,
//! and the client-side breakpoint list DAP needs (each set request replaces a
//! whole group).

use crate::dap::DapClient;
use crate::host;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_SESSIONS: usize = 8;
const FIRST_STOP_WAIT: Duration = Duration::from_secs(10);
const SHUTTING_DOWN: &str = "the live reversing server is shutting down";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Clone, Debug, PartialEq)]
pub enum BpSpec {
    Function(String),
    Address(u64),
    Line { file: String, line: u64 },
}

impl BpSpec {
    fn same_group(&self, other: &BpSpec) -> bool {
        match (self, other) {
            (BpSpec::Function(_), BpSpec::Function(_)) => true,
            (BpSpec::Address(_), BpSpec::Address(_)) => true,
            (BpSpec::Line { file: a, .. }, BpSpec::Line { file: b, .. }) => a == b,
            _ => false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Breakpoint {
    pub id: u64,
    pub spec: BpSpec,
    pub condition: Option<String>,
    /// Last DAP `Breakpoint` object the adapter reported.
    pub state: Value,
}

impl Breakpoint {
    pub fn to_json(&self) -> Value {
        let (kind, location) = match &self.spec {
            BpSpec::Function(name) => ("function", json!({"function": name})),
            BpSpec::Address(addr) => ("address", json!({"address": format!("0x{addr:x}")})),
            BpSpec::Line { file, line } => ("line", json!({"file": file, "line": line})),
        };
        json!({
            "id": self.id,
            "kind": kind,
            "location": location,
            "condition": self.condition,
            "verified": self.state.get("verified").and_then(Value::as_bool).unwrap_or(false),
            "message": self.state.get("message"),
            "resolved": {
                "line": self.state.get("line"),
                "source": self.state.pointer("/source/path"),
                "instructionReference": self.state.get("instructionReference"),
            },
        })
    }
}

#[derive(Default)]
struct BreakpointList {
    next_id: u64,
    list: Vec<Breakpoint>,
}

pub struct Session {
    pub id: String,
    pub target: String,
    /// `launch` or `attach`.
    pub mode: &'static str,
    pub label: String,
    pub dap: Arc<DapClient>,
    pub capabilities: Value,
    breakpoints: Mutex<BreakpointList>,
}

impl Session {
    pub fn to_json(&self) -> Value {
        let (state, exit_code, pid, output_seq, closed) = self.dap.with_state(|s| {
            (
                s.run_state.clone(),
                s.exit_code,
                s.process_id,
                s.output.last_seq(),
                s.closed,
            )
        });
        json!({
            "sessionId": self.id,
            "target": self.target,
            "mode": self.mode,
            "label": self.label,
            "pid": pid,
            "state": if closed { "closed".to_string() } else { state },
            "exitCode": exit_code,
            "outputSeq": output_seq,
        })
    }

    /// Thread from the last stop, else the first live thread.
    pub fn default_thread(&self) -> Result<i64, String> {
        if let Some(id) = self.dap.with_state(|s| {
            s.last_stop
                .as_ref()
                .and_then(|b| b.get("threadId"))
                .and_then(Value::as_i64)
        }) {
            return Ok(id);
        }
        let body = self.dap.request("threads", json!({}), REQUEST_TIMEOUT)?;
        body.pointer("/threads/0/id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "the process has no threads".to_string())
    }

    pub fn breakpoints(&self) -> Vec<Breakpoint> {
        let mut bps = lock(&self.breakpoints);
        self.apply_breakpoint_events(&mut bps);
        bps.list.clone()
    }

    /// Folds adapter `breakpoint` events (late resolution, moves) into the list.
    fn apply_breakpoint_events(&self, bps: &mut BreakpointList) {
        let events = self
            .dap
            .with_state(|s| std::mem::take(&mut s.breakpoint_events));
        for (adapter_id, state) in events {
            if let Some(bp) = bps
                .list
                .iter_mut()
                .find(|b| b.state.get("id").and_then(Value::as_i64) == Some(adapter_id))
            {
                bp.state = state;
            }
        }
    }

    /// Adds a breakpoint and re-sends its group; rolls back if the adapter rejects it.
    pub fn add_breakpoint(
        &self,
        spec: BpSpec,
        condition: Option<String>,
    ) -> Result<Breakpoint, String> {
        let mut bps = lock(&self.breakpoints);
        bps.next_id += 1;
        let id = bps.next_id;
        bps.list.push(Breakpoint {
            id,
            spec: spec.clone(),
            condition,
            state: Value::Null,
        });
        if let Err(error) = self.send_group(&mut bps, &spec) {
            bps.list.retain(|b| b.id != id);
            return Err(error);
        }
        bps.list
            .iter()
            .find(|b| b.id == id)
            .cloned()
            .ok_or_else(|| "breakpoint vanished".to_string())
    }

    /// Removes one breakpoint (or all when `id` is None); returns how many.
    pub fn clear_breakpoints(&self, id: Option<u64>) -> Result<usize, String> {
        let mut bps = lock(&self.breakpoints);
        let removed: Vec<Breakpoint> = bps
            .list
            .iter()
            .filter(|b| id.is_none_or(|id| b.id == id))
            .cloned()
            .collect();
        if removed.is_empty() {
            return match id {
                Some(id) => Err(format!("no breakpoint with id {id}")),
                None => Ok(0),
            };
        }
        bps.list.retain(|b| id.is_some_and(|id| b.id != id));
        let mut groups: Vec<BpSpec> = Vec::new();
        for bp in &removed {
            if !groups.iter().any(|g| g.same_group(&bp.spec)) {
                groups.push(bp.spec.clone());
            }
        }
        for group in groups {
            self.send_group(&mut bps, &group)?;
        }
        Ok(removed.len())
    }

    fn send_group(&self, bps: &mut BreakpointList, group: &BpSpec) -> Result<(), String> {
        let members: Vec<usize> = bps
            .list
            .iter()
            .enumerate()
            .filter(|(_, b)| b.spec.same_group(group))
            .map(|(i, _)| i)
            .collect();
        let entries: Vec<Value> = members
            .iter()
            .map(|&i| {
                let bp = &bps.list[i];
                let mut entry = match &bp.spec {
                    BpSpec::Function(name) => json!({"name": name}),
                    BpSpec::Address(addr) => json!({"instructionReference": format!("0x{addr:x}")}),
                    BpSpec::Line { line, .. } => json!({"line": line}),
                };
                if let (Some(condition), Some(obj)) = (&bp.condition, entry.as_object_mut()) {
                    obj.insert("condition".into(), json!(condition));
                }
                entry
            })
            .collect();
        let (command, args) = match group {
            BpSpec::Function(_) => ("setFunctionBreakpoints", json!({"breakpoints": entries})),
            BpSpec::Address(_) => {
                if self
                    .capabilities
                    .get("supportsInstructionBreakpoints")
                    .and_then(Value::as_bool)
                    != Some(true)
                {
                    return Err(
                        "this lldb-dap does not support address (instruction) breakpoints; \
                                use re_evaluate with `breakpoint set -a <address>` instead"
                            .into(),
                    );
                }
                ("setInstructionBreakpoints", json!({"breakpoints": entries}))
            }
            BpSpec::Line { file, .. } => (
                "setBreakpoints",
                json!({"source": {"path": file}, "breakpoints": entries}),
            ),
        };
        // Events from before this request are older than its response; events
        // that arrive later stay buffered and win on the next read.
        self.apply_breakpoint_events(bps);
        let body = self.dap.request(command, args, REQUEST_TIMEOUT)?;
        let reported = body
            .get("breakpoints")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (slot, state) in members.iter().zip(reported) {
            bps.list[*slot].state = state;
        }
        Ok(())
    }

    /// Politely ends the debug session, then kills lldb-dap.
    pub fn shutdown(&self, terminate_debuggee: bool) {
        let alive = self.dap.with_state(|s| !s.closed);
        if alive {
            let _ = self.dap.request(
                "disconnect",
                json!({"terminateDebuggee": terminate_debuggee}),
                Duration::from_secs(5),
            );
        }
        self.dap.close();
    }
}

fn initialize_arguments() -> Value {
    json!({
        "clientID": "viscosity-live-re",
        "clientName": "ViscosityCode live reversing",
        "adapterID": "lldb-dap",
        "pathFormat": "path",
        "linesStartAt1": true,
        "columnsStartAt1": true,
        "supportsVariableType": true,
        "supportsMemoryReferences": true,
        "supportsRunInTerminalRequest": false,
        "supportsStartDebuggingRequest": false,
        "supportsProgressReporting": false,
        "supportsInvalidatedEvent": false,
    })
}

pub struct StartRequest {
    pub target: String,
    pub mode: &'static str,
    pub label: String,
    /// `launch` / `attach` arguments.
    pub arguments: Value,
    pub timeout: Duration,
    /// Wait for the first `stopped` event (entry or attach stop).
    pub wait_for_stop: bool,
}

/// Runs initialize → launch/attach → configurationDone. Handles both adapter
/// orders: response before `initialized` (older lldb-dap) and response after
/// configurationDone (LLVM 21+). Returns the session and its first stop event.
fn handshake(dap: &DapClient, request: &StartRequest) -> Result<(Value, Option<Value>), String> {
    let capabilities = dap.request("initialize", initialize_arguments(), REQUEST_TIMEOUT)?;
    let seq = dap.send(request.mode, request.arguments.clone())?;
    let initialized = dap.wait_until(request.timeout, |s| s.initialized || s.has_response(seq));
    if !initialized {
        let reason = adapter_reason(dap);
        return Err(format!(
            "{} did not complete within {} s{reason}",
            request.mode,
            request.timeout.as_secs()
        ));
    }
    let early = dap.with_state(|s| !s.initialized) || dap.has_response(seq);
    if early {
        // The response came first: surface a failure before configurationDone.
        if let Err(error) = dap.wait_response(seq, REQUEST_TIMEOUT) {
            return Err(format!("{error}{}", adapter_reason(dap)));
        }
        // Older adapters send `initialized` right after the response.
        dap.wait_until(Duration::from_secs(2), |s| s.initialized);
    }
    let done = dap.request("configurationDone", json!({}), REQUEST_TIMEOUT);
    if !early && let Err(error) = dap.wait_response(seq, request.timeout) {
        return Err(format!("{error}{}", adapter_reason(dap)));
    }
    done?;
    let first_stop =
        if request.wait_for_stop && dap.wait_until(FIRST_STOP_WAIT, |s| !s.run_events.is_empty()) {
            dap.with_state(|s| s.run_events.pop_front())
        } else {
            None
        };
    Ok((capabilities, first_stop))
}

/// Recent console/stderr lines from lldb-dap that explain a failure.
fn adapter_reason(dap: &DapClient) -> String {
    let text: String = dap.with_state(|s| {
        let (chunks, _) = s.output.read_since(0, 4096);
        chunks
            .into_iter()
            .filter(|c| c.category != "stdout")
            .map(|c| c.text)
            .collect()
    });
    let text = text.trim();
    if text.is_empty() {
        String::new()
    } else {
        format!(" (lldb-dap: {text})")
    }
}

#[derive(Default)]
pub struct Sessions {
    map: Mutex<BTreeMap<String, Arc<Session>>>,
    /// Adapters still in their launch/attach handshake, so close_all reaches them.
    starting: Mutex<BTreeMap<String, Arc<DapClient>>>,
    /// Set by close_all (under `starting`); refuses new sessions.
    closing: AtomicBool,
    next: AtomicU64,
}

impl Sessions {
    fn next_id(&self) -> String {
        format!("s{}", self.next.fetch_add(1, Ordering::Relaxed) + 1)
    }

    pub fn count(&self) -> usize {
        lock(&self.map).len()
    }

    /// Spawns lldb-dap, runs initialize → launch/attach → configurationDone, and
    /// opens the session. Returns the session and its first stop event.
    pub fn start(&self, request: StartRequest) -> Result<(Arc<Session>, Option<Value>), String> {
        let debugger = host::find_debugger()?;
        let id = self.next_id();
        let dap = {
            // Spawn under the lock so close_all never misses a fresh child.
            let mut starting = lock(&self.starting);
            if self.closing.load(Ordering::Acquire) {
                return Err(SHUTTING_DOWN.into());
            }
            let dap = Arc::new(
                DapClient::spawn(&debugger)
                    .map_err(|e| format!("could not start {}: {e}", debugger.display()))?,
            );
            starting.insert(id.clone(), Arc::clone(&dap));
            dap
        };
        let started = handshake(&dap, &request);
        let mut starting = lock(&self.starting);
        let claimed = starting.remove(&id).is_some();
        let (capabilities, first_stop) = match (started, claimed) {
            (Ok(done), true) => done,
            (result, claimed) => {
                drop(starting);
                dap.close();
                // Unclaimed means close_all already took (and closed) the adapter.
                return Err(match (result, claimed) {
                    (Err(error), true) => error,
                    _ => SHUTTING_DOWN.into(),
                });
            }
        };
        let session = Arc::new(Session {
            id: id.clone(),
            target: request.target,
            mode: request.mode,
            label: request.label,
            dap,
            capabilities,
            breakpoints: Mutex::new(BreakpointList::default()),
        });
        // Still under `starting`, so close_all sees it either here or in the map.
        lock(&self.map).insert(id, Arc::clone(&session));
        Ok((session, first_stop))
    }

    pub fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        lock(&self.map)
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no session {id:?}; see re_sessions"))
    }

    pub fn remove(&self, id: &str) -> Option<Arc<Session>> {
        lock(&self.map).remove(id)
    }

    pub fn list(&self) -> Vec<Arc<Session>> {
        lock(&self.map).values().cloned().collect()
    }

    /// Ends every session: launched debuggees are killed, attached ones detached.
    /// Adapters still starting are killed, and later starts are refused.
    pub fn close_all(&self) {
        let starting: Vec<Arc<DapClient>> = {
            let mut starting = lock(&self.starting);
            self.closing.store(true, Ordering::Release);
            std::mem::take(&mut *starting).into_values().collect()
        };
        for dap in starting {
            dap.close();
        }
        let all: Vec<Arc<Session>> = std::mem::take(&mut *lock(&self.map))
            .into_values()
            .collect();
        for session in all {
            session.shutdown(session.mode == "launch");
        }
    }
}

#[cfg(test)]
impl Sessions {
    /// Opens a session over an in-process fake adapter.
    pub(crate) fn insert_fake(&self, dap: DapClient) -> Arc<Session> {
        let id = self.next_id();
        let session = Arc::new(Session {
            id: id.clone(),
            target: "local".into(),
            mode: "attach",
            label: "fake".into(),
            dap: Arc::new(dap),
            capabilities: json!({}),
            breakpoints: Mutex::new(BreakpointList::default()),
        });
        lock(&self.map).insert(id, Arc::clone(&session));
        session
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::dap::fake::connect;
    use std::thread;

    #[test]
    fn breakpoint_event_updates_listed_state() {
        let (client, mut fake) = connect();
        let session = Sessions::default().insert_fake(client);
        let adapter = thread::spawn(move || {
            let request = fake.next_request();
            assert_eq!(request["command"], "setFunctionBreakpoints");
            fake.reply(
                &request,
                json!({"breakpoints": [{"id": 7, "verified": false, "message": "pending"}]}),
            );
            fake.event(
                "breakpoint",
                json!({"reason": "changed", "breakpoint": {
                    "id": 7, "verified": true, "instructionReference": "0x1000"}}),
            );
            fake
        });
        session
            .add_breakpoint(BpSpec::Function("usleep".into()), None)
            .unwrap();
        let _fake = adapter.join().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let listed = loop {
            let listed = session.breakpoints()[0].to_json();
            if listed["verified"] == true || std::time::Instant::now() > deadline {
                break listed;
            }
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(listed["verified"], true, "{listed}");
        assert_eq!(listed["resolved"]["instructionReference"], "0x1000");
        assert_eq!(listed["message"], Value::Null);
    }

    #[test]
    fn close_all_refuses_new_starts() {
        let sessions = Sessions::default();
        sessions.close_all();
        let request = StartRequest {
            target: "local".into(),
            mode: "launch",
            label: "x".into(),
            arguments: json!({}),
            timeout: Duration::from_secs(1),
            wait_for_stop: false,
        };
        // Without lldb-dap installed start fails earlier, with a different error.
        if host::find_debugger().is_ok() {
            assert_eq!(sessions.start(request).err().unwrap(), SHUTTING_DOWN);
        }
    }
}
