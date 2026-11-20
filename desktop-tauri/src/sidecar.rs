//! The standalone host sidecar: `runtime/node lib/server.cjs serve` from an
//! extracted standalone archive, its readiness, and its graceful stop.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use tauri::Url;

use crate::owner::{StartFailure, classify};
use crate::pairing;

/// Local smoke runs point this at an extracted standalone archive until the
/// bundle ships one under the resource dir (P3/P5).
pub const STANDALONE_DIR_ENV: &str = "VISCOSITY_TAURI_STANDALONE_DIR";
/// Smoke runs point this at a disposable root; the default is the production root.
pub const BASE_DIR_ENV: &str = "VISCOSITY_TAURI_BASE_DIR";
const READY_PREFIX: &str = "[poracode-server] listening at:";
const PAIRING_TIMEOUT: Duration = Duration::from_secs(20);
/// The server drains for up to 10 s (passed explicitly below), then is killed.
const DRAIN_DEADLINE_MS: &str = "10000";
const STOP_DEADLINE: Duration = Duration::from_secs(12);
const POLL: Duration = Duration::from_millis(250);
const STDERR_TAIL: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub node: PathBuf,
    pub server: PathBuf,
}

impl Layout {
    /// The archive layout from scripts/build-standalone-archive.mjs.
    pub fn new(dir: &Path) -> Self {
        let node = if cfg!(windows) { "node.exe" } else { "node" };
        Self {
            node: dir.join("runtime").join(node),
            server: dir.join("lib").join("server.cjs"),
        }
    }

    pub fn command(&self, base_dir: &Path, args: &[OsString]) -> Command {
        let mut command = Command::new(&self.node);
        command
            .args(args)
            .envs(server_env(base_dir))
            .stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }
}

/// `VISCOSITY_TAURI_BASE_DIR` when set and non-blank, else `~/.viscositycode`.
/// A shell-wide `PORACODE_BASE_DIR` is deliberately ignored so the shell never
/// lands on another profile such as `~/.viscositycode-dev`.
pub fn base_dir(override_dir: Option<OsString>, home: &Path) -> PathBuf {
    match override_dir {
        Some(dir) if !dir.to_string_lossy().trim().is_empty() => PathBuf::from(dir),
        _ => home.join(".viscositycode"),
    }
}

pub fn server_env(base_dir: &Path) -> [(&'static str, OsString); 2] {
    [
        ("PORACODE_BASE_DIR", base_dir.as_os_str().to_owned()),
        (
            "PORACODE_SHUTDOWN_DRAIN_DEADLINE_MS",
            OsString::from(DRAIN_DEADLINE_MS),
        ),
    ]
}

/// Only `serve` gets this; the host deletes it before spawning agents.
pub fn parent_pid_env(pid: u32) -> (&'static str, OsString) {
    ("PORACODE_PARENT_PID", OsString::from(pid.to_string()))
}

/// `--host` is explicit so a config file can never widen the bind.
pub fn serve_args(server: &Path, port: u16) -> Vec<OsString> {
    let mut args = vec![server.as_os_str().to_owned()];
    args.extend(
        [
            "serve",
            "--no-open",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ]
        .map(OsString::from),
    );
    args
}

/// The URL from `[poracode-server] listening at:      http://127.0.0.1:<port>` (cli.ts).
pub fn parse_ready_line(line: &str) -> Option<&str> {
    let url = line.trim().strip_prefix(READY_PREFIX)?.trim();
    (!url.is_empty()).then_some(url)
}

#[derive(Debug)]
pub enum Line {
    Out(String),
    Err(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    Ready,
    /// The child exited first; carries the tail of its stderr.
    Exited(String),
}

/// Waits for our child's ready line or its exit. No port probe: a foreign
/// listener on the port (a dev `serve`, a stale server) must never pass for
/// ours. No time limit either: a first start (migration, import) on a slow
/// machine may take minutes, and killing the data root's owner mid-startup is
/// worse than waiting. Quit still stops it through `shutdown`.
pub fn wait_ready(
    lines: &Receiver<Line>,
    mut has_exited: impl FnMut() -> io::Result<bool>,
) -> io::Result<Startup> {
    let mut stderr = String::new();
    loop {
        match lines.recv_timeout(POLL) {
            Ok(Line::Out(line)) if parse_ready_line(&line).is_some() => return Ok(Startup::Ready),
            Ok(Line::Err(line)) => push_tail(&mut stderr, &line),
            Ok(Line::Out(_)) | Err(RecvTimeoutError::Timeout) => {}
            // Both pipes closed: only the exit check below can end the wait.
            Err(RecvTimeoutError::Disconnected) => thread::sleep(POLL),
        }
        if has_exited()? {
            while let Ok(line) = lines.recv_timeout(Duration::from_millis(200)) {
                if let Line::Err(line) = line {
                    push_tail(&mut stderr, &line);
                }
            }
            return Ok(Startup::Exited(stderr));
        }
    }
}

fn push_tail(buffer: &mut String, line: &str) {
    buffer.push_str(line);
    buffer.push('\n');
    if buffer.len() > STDERR_TAIL {
        let cut = buffer.len() - STDERR_TAIL;
        let cut = (cut..buffer.len())
            .find(|&index| buffer.is_char_boundary(index))
            .unwrap_or(buffer.len());
        buffer.drain(..cut);
    }
}

pub trait Process {
    fn has_exited(&mut self) -> io::Result<bool>;
    fn request_stop(&mut self) -> io::Result<()>;
    fn kill(&mut self) -> io::Result<()>;
}

/// Ask for a graceful drain, wait up to `deadline`, then kill.
pub fn stop(process: &mut impl Process, deadline: Duration, poll: Duration) -> io::Result<()> {
    if process.has_exited()? {
        return Ok(());
    }
    if let Err(error) = process.request_stop() {
        eprintln!("viscositycode-desktop: graceful stop request failed: {error}");
    }
    let start = Instant::now();
    while start.elapsed() < deadline {
        if process.has_exited()? {
            return Ok(());
        }
        thread::sleep(poll);
    }
    process.kill()
}

/// The `serve` child this shell started and therefore owns.
pub struct OwnedServer {
    child: Child,
    // Used by the Windows stop path only.
    #[cfg_attr(unix, allow(dead_code))]
    layout: Layout,
    #[cfg_attr(unix, allow(dead_code))]
    base_dir: PathBuf,
}

impl Process for OwnedServer {
    fn has_exited(&mut self) -> io::Result<bool> {
        Ok(self.child.try_wait()?.is_some())
    }

    #[cfg(unix)]
    fn request_stop(&mut self) -> io::Result<()> {
        let pid = libc::pid_t::try_from(self.child.id()).map_err(io::Error::other)?;
        // SAFETY: plain syscall; `stop` checked the child is not yet reaped, so the pid is ours.
        if unsafe { libc::kill(pid, libc::SIGTERM) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// Windows has no SIGTERM; `stop --if-pid` refuses any owner but our child.
    #[cfg(not(unix))]
    fn request_stop(&mut self) -> io::Result<()> {
        let mut args = vec![self.layout.server.as_os_str().to_owned()];
        args.extend(["stop", "--if-pid", &self.child.id().to_string()].map(OsString::from));
        self.layout
            .command(&self.base_dir, &args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(drop)
    }

    /// The child leads its own process group (see `launch`), so this also
    /// reaches agents it started that kept the group (PTY sessions call setsid
    /// and leave it; the server's own drain stops those).
    #[cfg(unix)]
    fn kill(&mut self) -> io::Result<()> {
        let pgid = libc::pid_t::try_from(self.child.id()).map_err(io::Error::other)?;
        // SAFETY: plain syscall; `stop` checked the leader is not yet reaped, so the group id is ours.
        if unsafe { libc::killpg(pgid, libc::SIGKILL) } != 0 {
            let error = io::Error::last_os_error();
            eprintln!("viscositycode-desktop: killing the server group failed: {error}");
            self.child.kill()?;
        }
        self.child.wait().map(drop)
    }

    // Windows job object (kill on close) is deferred in the plan; until then
    // agents can outlive a killed server there.
    #[cfg(not(unix))]
    fn kill(&mut self) -> io::Result<()> {
        self.child.kill()?;
        self.child.wait().map(drop)
    }
}

/// Shared with the exit handler so a quit during startup still stops the child.
pub type Slot = Mutex<SlotState>;

#[derive(Default)]
pub struct SlotState {
    /// Set by `shutdown`: no child may be started or stored after it.
    exiting: bool,
    server: Option<OwnedServer>,
}

fn lock(slot: &Slot) -> MutexGuard<'_, SlotState> {
    slot.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Stops the owned server, if any. Never touches an owner this shell attached to.
pub fn stop_slot(slot: &Slot) {
    let taken = lock(slot).server.take();
    stop_owned(taken);
}

/// The exit handler: stop the owned server and refuse any later launch.
pub fn shutdown(slot: &Slot) {
    let taken = {
        let mut state = lock(slot);
        state.exiting = true;
        state.server.take()
    };
    stop_owned(taken);
}

fn stop_owned(server: Option<OwnedServer>) {
    if let Some(mut server) = server
        && let Err(error) = stop(&mut server, STOP_DEADLINE, POLL)
    {
        eprintln!("viscositycode-desktop: stopping the server failed: {error}");
    }
}

/// Why `launch` produced no pairing URL; the shell's error page words each case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// The bundled `runtime/node` or `lib/server.cjs` is not there.
    MissingRuntime(String),
    /// Another process owns the data root, and pairing with it failed.
    OwnerBusy(String),
    /// The root's credential key needs an explicit activation (an Electron root).
    CredentialCustody(String),
    Other(String),
}

impl Failure {
    pub fn detail(&self) -> &str {
        match self {
            Self::MissingRuntime(detail)
            | Self::OwnerBusy(detail)
            | Self::CredentialCustody(detail)
            | Self::Other(detail) => detail,
        }
    }
}

impl From<String> for Failure {
    fn from(detail: String) -> Self {
        Self::Other(detail)
    }
}

pub struct Config {
    pub dir: PathBuf,
    pub base_dir: PathBuf,
    pub port: u16,
    pub log: PathBuf,
}

/// Starts (or, when the root is owned elsewhere, attaches to) the host and
/// returns the one-time pairing URL the window should load.
pub fn launch(config: &Config, slot: &Slot) -> Result<Url, Failure> {
    // A retry after a failed pairing must not leave the earlier child unowned.
    stop_slot(slot);
    let layout = Layout::new(&config.dir);
    for path in [&layout.node, &layout.server] {
        if !path.is_file() {
            return Err(Failure::MissingRuntime(format!(
                "Missing {}. Set {STANDALONE_DIR_ENV} to an extracted standalone archive.",
                path.display()
            )));
        }
    }
    if let Some(parent) = config.log.parent() {
        std::fs::create_dir_all(parent).map_err(|error| describe("create the log dir", error))?;
    }
    // shortcut: truncated per launch; the server keeps its own rotated log in the data root.
    let log = File::create(&config.log).map_err(|error| describe("open the log", error))?;
    let lines = {
        // Spawn and store under one lock so `shutdown` either refuses this
        // launch or sees the child: no window where an owner escapes the slot.
        let mut state = lock(slot);
        if state.exiting {
            return Err(Failure::Other("The app is quitting.".into()));
        }
        let mut command =
            layout.command(&config.base_dir, &serve_args(&layout.server, config.port));
        // The host's parent watchdog drains it if this shell dies without a clean quit.
        let (key, value) = parent_pid_env(std::process::id());
        command.env(key, value);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own group, so the kill path can reach its children too.
            command.process_group(0);
        }
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| describe("start the server", error))?;
        let (sender, lines) = mpsc::channel();
        if let Some(stdout) = child.stdout.take() {
            pipe(stdout, Line::Out, sender.clone(), &log);
        }
        if let Some(stderr) = child.stderr.take() {
            pipe(stderr, Line::Err, sender, &log);
        }
        state.server = Some(OwnedServer {
            child,
            layout: layout.clone(),
            base_dir: config.base_dir.clone(),
        });
        lines
    };
    let has_exited = || match lock(slot).server.as_mut() {
        Some(server) => server.has_exited(),
        None => Ok(true), // stopped by the exit handler
    };
    let startup =
        wait_ready(&lines, has_exited).map_err(|error| describe("watch the server", error))?;
    match startup {
        Startup::Ready => Ok(pair(&layout, &config.base_dir, &log)?),
        Startup::Exited(stderr) => {
            // Already reaped: drop it so no later stop can signal a reused pid.
            lock(slot).server.take();
            match classify(&stderr) {
                // Become a client of the existing owner, never a second writer.
                StartFailure::RootInUse => {
                    pair(&layout, &config.base_dir, &log).map_err(Failure::OwnerBusy)
                }
                StartFailure::ImportRequired => Err(Failure::Other(format!(
                    "{} holds files the host will not adopt without an import \
                     (for example agent-probe). Nothing was changed.\n\n{}",
                    config.base_dir.display(),
                    stderr.trim()
                ))),
                StartFailure::CredentialCustody => Err(Failure::CredentialCustody(format!(
                    "{} has a credential key this app cannot unseal. Nothing was changed.\n\n{}",
                    config.base_dir.display(),
                    stderr.trim()
                ))),
                StartFailure::Other => Err(Failure::Other(format!(
                    "The server exited during startup.\n\n{}",
                    stderr.trim()
                ))),
            }
        }
    }
}

fn pair(layout: &Layout, base_dir: &Path, log: &File) -> Result<Url, String> {
    let stderr = log
        .try_clone()
        .map_err(|error| describe("open the log", error))?;
    let mut child = layout
        .command(base_dir, &pairing::create_args(&layout.server))
        .stdout(Stdio::piped())
        .stderr(stderr)
        .spawn()
        .map_err(|error| describe("run pairings create", error))?;
    let mut stdout = child.stdout.take().ok_or("pairings create has no stdout")?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        let _ = sender.send(output);
    });
    let output = receiver.recv_timeout(PAIRING_TIMEOUT);
    if output.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    match output {
        Ok(output) => pairing::parse(&output),
        Err(_) => Err(format!(
            "pairings create did not answer within {} s.",
            PAIRING_TIMEOUT.as_secs()
        )),
    }
}

/// Copies each line to the log and the startup waiter. Keeps draining after
/// the waiter is gone so the server never blocks on a full pipe.
fn pipe(
    reader: impl Read + Send + 'static,
    wrap: fn(String) -> Line,
    sender: Sender<Line>,
    log: &File,
) {
    let mut log = log.try_clone().ok();
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Some(log) = log.as_mut() {
                        let _ = log.write_all(&buffer);
                    }
                    let line = String::from_utf8_lossy(&buffer).trim_end().to_owned();
                    let _ = sender.send(wrap(line));
                }
            }
        }
    });
}

fn describe(action: &str, error: io::Error) -> String {
    format!("Could not {action}: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_and_args() {
        let layout = Layout::new(Path::new("/s"));
        assert_eq!(layout.server, Path::new("/s/lib/server.cjs"));
        assert!(layout.node.starts_with("/s/runtime"));
        let args = serve_args(&layout.server, 49380);
        // Path equality is per component; the joined string uses the OS separator.
        assert_eq!(Path::new(&args[0]), Path::new("/s/lib/server.cjs"));
        assert_eq!(
            args[1..],
            [
                "serve",
                "--no-open",
                "--host",
                "127.0.0.1",
                "--port",
                "49380"
            ]
            .map(OsString::from)
        );
        let env = server_env(Path::new("/h/.viscositycode"));
        assert_eq!(env[0], ("PORACODE_BASE_DIR", "/h/.viscositycode".into()));
        assert_eq!(
            env[1],
            ("PORACODE_SHUTDOWN_DRAIN_DEADLINE_MS", "10000".into())
        );
        let command = layout.command(Path::new("/h/.viscositycode"), &args);
        assert_eq!(command.get_program(), layout.node.as_os_str());
        assert_eq!(command.get_envs().count(), 2);
    }

    #[test]
    fn parent_pid_env_names_the_shell() {
        assert_eq!(parent_pid_env(4242), ("PORACODE_PARENT_PID", "4242".into()));
    }

    #[test]
    fn base_dir_defaults_to_production_root() {
        let home = Path::new("/h");
        assert_eq!(base_dir(None, home), Path::new("/h/.viscositycode"));
        assert_eq!(
            base_dir(Some(" ".into()), home),
            Path::new("/h/.viscositycode")
        );
        assert_eq!(base_dir(Some("/tmp/r".into()), home), Path::new("/tmp/r"));
    }

    #[test]
    fn parses_ready_line() {
        assert_eq!(
            parse_ready_line("[poracode-server] listening at:      http://127.0.0.1:49380\n"),
            Some("http://127.0.0.1:49380")
        );
        assert_eq!(
            parse_ready_line("[poracode-server] websocket at:      ws://x"),
            None
        );
        assert_eq!(parse_ready_line("[poracode-server] listening at:   "), None);
        assert_eq!(parse_ready_line("listening at: http://127.0.0.1:1"), None);
    }

    #[test]
    fn waits_for_ready_line() {
        let (sender, lines) = mpsc::channel();
        sender
            .send(Line::Out("[poracode-server] log file: x".into()))
            .unwrap();
        sender
            .send(Line::Out(
                "[poracode-server] listening at: http://127.0.0.1:1".into(),
            ))
            .unwrap();
        let startup = wait_ready(&lines, || Ok(false)).unwrap();
        assert_eq!(startup, Startup::Ready);
    }

    #[test]
    fn reports_exit_with_stderr() {
        let (sender, lines) = mpsc::channel();
        sender
            .send(Line::Err(
                "[poracode-server] Poracode already owns /r.".into(),
            ))
            .unwrap();
        drop(sender);
        let startup = wait_ready(&lines, || Ok(true)).unwrap();
        assert_eq!(
            startup,
            Startup::Exited("[poracode-server] Poracode already owns /r.\n".into())
        );
    }

    #[test]
    fn keeps_waiting_while_the_child_lives() {
        let (_sender, lines) = mpsc::channel();
        let mut polls = 0;
        let startup = wait_ready(&lines, || {
            polls += 1;
            Ok(polls > 3)
        })
        .unwrap();
        assert_eq!(startup, Startup::Exited(String::new()));
        assert_eq!(
            polls, 4,
            "no deadline ends the wait while the child is alive"
        );
    }

    #[test]
    fn stderr_tail_is_bounded() {
        let mut buffer = String::new();
        for _ in 0..10_000 {
            push_tail(&mut buffer, "é line of stderr");
        }
        assert!(buffer.len() <= STDERR_TAIL);
        assert!(buffer.ends_with("é line of stderr\n"));
    }

    struct Fake {
        calls: Vec<&'static str>,
        exits_after_stop: bool,
        stopped: bool,
    }

    impl Process for Fake {
        fn has_exited(&mut self) -> io::Result<bool> {
            self.calls.push("poll");
            Ok(self.stopped && self.exits_after_stop)
        }
        fn request_stop(&mut self) -> io::Result<()> {
            self.calls.push("term");
            self.stopped = true;
            Ok(())
        }
        fn kill(&mut self) -> io::Result<()> {
            self.calls.push("kill");
            Ok(())
        }
    }

    #[test]
    fn stop_drains_before_kill() {
        let poll = Duration::from_millis(1);
        let mut graceful = Fake {
            calls: vec![],
            exits_after_stop: true,
            stopped: false,
        };
        stop(&mut graceful, Duration::from_millis(50), poll).unwrap();
        assert_eq!(graceful.calls, ["poll", "term", "poll"]);

        let mut stuck = Fake {
            calls: vec![],
            exits_after_stop: false,
            stopped: false,
        };
        stop(&mut stuck, Duration::from_millis(20), poll).unwrap();
        assert_eq!(stuck.calls[..2], ["poll", "term"]);
        assert_eq!(stuck.calls.last(), Some(&"kill"));
        assert!(!stuck.calls[2..stuck.calls.len() - 1].contains(&"kill"));

        let mut gone = Fake {
            calls: vec![],
            exits_after_stop: true,
            stopped: true,
        };
        stop(&mut gone, Duration::from_millis(20), poll).unwrap();
        assert_eq!(gone.calls, ["poll"], "an exited child is never signalled");
    }

    /// A disposable standalone dir whose `runtime/node` is a shell script.
    /// `serve` behaves per `mode`; `pairings` prints a pairing link. Each call
    /// appends its subcommand to `argv`.
    #[cfg(unix)]
    mod launch {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        /// One fake runtime at a time: forking while another thread holds a
        /// freshly written script open can fail with ETXTBSY on Linux.
        static SERIAL: Mutex<()> = Mutex::new(());

        const NODE: &str = r#"#!/bin/sh
dir=$(cd "$(dirname "$0")/.." && pwd)
echo "$2" >> "$dir/argv"
case "$2" in
serve)
  case "$(cat "$dir/mode")" in
  busy)
    echo "[poracode-server] Poracode already owns $PORACODE_BASE_DIR.host-v1. Stop the running owner before starting another owner; use a different PORACODE_BASE_DIR for a separate profile." >&2
    exit 1 ;;
  sealed)
    echo "[poracode-server] failed to start: Error: Credential mode change requires explicit activation; the existing key was preserved." >&2
    exit 1 ;;
  crash)
    echo "Error: listen EADDRINUSE: address already in use 127.0.0.1:49380" >&2
    exit 1 ;;
  ready)
    echo "[poracode-server] listening at:      http://127.0.0.1:49380"
    exec sleep 30 ;;
  stubborn)
    trap '' TERM
    sleep 30 &
    echo $! > "$dir/grandchild"
    echo "[poracode-server] listening at:      http://127.0.0.1:49380"
    wait ;;
  esac ;;
pairings)
  echo '{"localPairingUrl":"http://127.0.0.1:49380/#pair=t"}' ;;
esac
"#;

        struct Fixture {
            dir: PathBuf,
            config: Config,
        }

        impl Fixture {
            fn new(name: &str, mode: &str) -> Self {
                let dir = std::env::temp_dir()
                    .join(format!("vc-tauri-launch-{}-{name}", std::process::id()));
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::create_dir_all(dir.join("runtime")).unwrap();
                std::fs::create_dir_all(dir.join("lib")).unwrap();
                std::fs::write(dir.join("lib/server.cjs"), "").unwrap();
                let node = dir.join("runtime/node");
                std::fs::write(&node, NODE).unwrap();
                std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
                std::fs::write(dir.join("mode"), mode).unwrap();
                let config = Config {
                    dir: dir.clone(),
                    base_dir: dir.join("root"),
                    port: 49380,
                    log: dir.join("logs/server.log"),
                };
                Self { dir, config }
            }

            fn argv(&self) -> Vec<String> {
                std::fs::read_to_string(self.dir.join("argv"))
                    .unwrap_or_default()
                    .lines()
                    .map(str::to_owned)
                    .collect()
            }
        }

        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.dir);
            }
        }

        fn serial() -> MutexGuard<'static, ()> {
            SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
        }

        fn alive(pid: libc::pid_t) -> bool {
            // SAFETY: signal 0 only checks that the pid exists.
            unsafe { libc::kill(pid, 0) == 0 }
        }

        #[test]
        fn root_in_use_attaches_and_never_starts_a_second_writer() {
            let _serial = serial();
            let fixture = Fixture::new("busy", "busy");
            let slot = Slot::default();
            let url = launch(&fixture.config, &slot).unwrap();
            assert_eq!(url.as_str(), "http://127.0.0.1:49380/#pair=t");
            assert_eq!(fixture.argv(), ["serve", "pairings"]);
            assert!(
                lock(&slot).server.is_none(),
                "the reaped child is dropped, and the other owner is never ours"
            );
        }

        #[test]
        fn other_exit_is_an_error_and_clears_the_slot() {
            let _serial = serial();
            let fixture = Fixture::new("crash", "crash");
            let slot = Slot::default();
            let failure = launch(&fixture.config, &slot).unwrap_err();
            assert!(matches!(failure, Failure::Other(_)), "{failure:?}");
            assert!(failure.detail().contains("EADDRINUSE"), "{failure:?}");
            assert_eq!(fixture.argv(), ["serve"]);
            assert!(lock(&slot).server.is_none());
        }

        #[test]
        fn electron_sealed_root_is_a_credential_failure_and_never_pairs() {
            let _serial = serial();
            let fixture = Fixture::new("sealed", "sealed");
            let slot = Slot::default();
            let failure = launch(&fixture.config, &slot).unwrap_err();
            assert!(
                matches!(failure, Failure::CredentialCustody(_)),
                "{failure:?}"
            );
            assert!(
                failure.detail().contains("Credential mode change"),
                "{failure:?}"
            );
            assert_eq!(fixture.argv(), ["serve"]);
            assert!(lock(&slot).server.is_none());
        }

        #[test]
        fn missing_runtime_spawns_nothing() {
            let _serial = serial();
            let fixture = Fixture::new("missing", "ready");
            std::fs::remove_file(fixture.dir.join("lib/server.cjs")).unwrap();
            let slot = Slot::default();
            let failure = launch(&fixture.config, &slot).unwrap_err();
            assert!(matches!(failure, Failure::MissingRuntime(_)), "{failure:?}");
            assert!(fixture.argv().is_empty());
        }

        #[test]
        fn ready_owns_the_child_until_shutdown_then_refuses_to_start() {
            let _serial = serial();
            let fixture = Fixture::new("ready", "ready");
            let slot = Slot::default();
            launch(&fixture.config, &slot).unwrap();
            assert_eq!(fixture.argv(), ["serve", "pairings"]);
            let pid = {
                let state = lock(&slot);
                let server = state.server.as_ref().unwrap();
                libc::pid_t::try_from(server.child.id()).unwrap()
            };
            assert!(alive(pid));

            shutdown(&slot);
            assert!(lock(&slot).server.is_none());
            assert!(!alive(pid), "stopped and reaped");

            // A retry racing the exit handler must not start an orphan owner.
            let failure = launch(&fixture.config, &slot).unwrap_err();
            assert_eq!(failure.detail(), "The app is quitting.");
            assert_eq!(fixture.argv(), ["serve", "pairings"]);
            assert!(lock(&slot).server.is_none());
        }

        #[test]
        fn kill_takes_the_whole_process_group() {
            let _serial = serial();
            let fixture = Fixture::new("stubborn", "stubborn");
            let slot = Slot::default();
            launch(&fixture.config, &slot).unwrap();
            let grandchild: libc::pid_t = std::fs::read_to_string(fixture.dir.join("grandchild"))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            assert!(alive(grandchild));
            let mut server = lock(&slot).server.take().unwrap();
            stop(
                &mut server,
                Duration::from_millis(300),
                Duration::from_millis(20),
            )
            .unwrap();
            assert!(server.has_exited().unwrap());
            // The orphaned grandchild is reaped by init/launchd shortly after SIGKILL.
            let start = Instant::now();
            while alive(grandchild) && start.elapsed() < Duration::from_secs(5) {
                thread::sleep(Duration::from_millis(20));
            }
            assert!(!alive(grandchild), "the server's children die with it");
        }
    }
}
