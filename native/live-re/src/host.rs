//! Host probing: debugger discovery, device tooling, process and device lists.
//! Every external command runs with a timeout and capped output.

use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Explicit lldb-dap path; wins over discovery.
pub const DEBUGGER_ENV: &str = "VISCOSITY_LIVE_RE_LLDB_DAP";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_COMMAND_OUTPUT: usize = 8 * 1024 * 1024;
/// Processes returned per `re_list_processes` call.
pub const MAX_PROCESSES: usize = 500;

pub struct CommandOutput {
    pub success: bool,
    /// Exit code; `None` when a signal ended the process.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn read_capped(mut reader: impl Read) -> String {
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break;
        }
        // Keep draining past the cap so the child never blocks on a full pipe.
        let room = MAX_COMMAND_OUTPUT.saturating_sub(out.len());
        out.extend_from_slice(&buf[..n.min(room)]);
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Runs `program args` without a shell, killing it after `timeout`.
pub fn run_command(
    program: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<CommandOutput, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let name = program.display().to_string();
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not run {name}: {e}"))?;
    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        thread::spawn(move || {
            let _ = tx.send((true, read_capped(stdout)));
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let _ = tx.send((false, read_capped(stderr)));
        });
    }
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{name} timed out after {} s", timeout.as_secs()));
            }
            Err(e) => return Err(format!("{name}: {e}")),
        }
    };
    let (mut stdout, mut stderr) = (String::new(), String::new());
    // A grandchild can keep a pipe open; don't wait on it forever.
    for _ in 0..2 {
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok((true, text)) => stdout = text,
            Ok((false, text)) => stderr = text,
            Err(_) => break,
        }
    }
    Ok(CommandOutput {
        success: status.success(),
        code: status.code(),
        stdout,
        stderr,
    })
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Developer tools in macOS `/usr/bin` (lldb, xcrun, clang, …) are xcrun
/// shims: running one without the Command Line Tools opens the CLT installer
/// dialog and steals focus. Lookups never return them; xcrun itself is only
/// reached through [`xcrun_path`] after `xcode-select -p` succeeded.
pub fn is_macos_shim(path: &Path) -> bool {
    cfg!(target_os = "macos") && path.parent() == Some(Path::new("/usr/bin"))
}

pub fn which(name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(&file))
        .find(|candidate| candidate.is_file() && !is_macos_shim(candidate))
}

/// The active developer directory (`xcode-select -p`). `xcode-select -p`
/// never prompts; it is the gate in front of every xcrun call.
#[cfg(target_os = "macos")]
pub fn developer_dir() -> Option<PathBuf> {
    let out = run_command(Path::new("/usr/bin/xcode-select"), &["-p"], COMMAND_TIMEOUT).ok()?;
    let dir = PathBuf::from(out.stdout.trim());
    (out.success && dir.is_dir()).then_some(dir)
}

#[cfg(not(target_os = "macos"))]
pub fn developer_dir() -> Option<PathBuf> {
    None
}

/// `/usr/bin/xcrun`, but only when a developer directory is selected.
pub fn xcrun_path(developer_dir: Option<&Path>) -> Option<PathBuf> {
    developer_dir?;
    let xcrun = Path::new("/usr/bin/xcrun");
    xcrun.is_file().then(|| xcrun.to_path_buf())
}

/// `xcrun -f <tool>`.
fn xcrun_find(xcrun: &Path, tool: &str) -> Option<PathBuf> {
    let out = run_command(xcrun, &["-f", tool], COMMAND_TIMEOUT).ok()?;
    let path = PathBuf::from(out.stdout.trim());
    (out.success && path.is_file()).then_some(path)
}

/// Standard LLVM install directories, newest versioned directory first.
fn llvm_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let env = |var: &str| std::env::var_os(var).map(PathBuf::from);
        // Machine installs (`winget install LLVM.LLVM`, the LLVM installer,
        // Chocolatey), per-user winget installs, then Scoop.
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(root) = env(var) {
                dirs.push(root.join("LLVM").join("bin"));
            }
        }
        if let Some(local) = env("LOCALAPPDATA") {
            dirs.push(local.join("Programs").join("LLVM").join("bin"));
        }
        if let Some(scoop) = env("SCOOP").or_else(|| env("USERPROFILE").map(|h| h.join("scoop"))) {
            dirs.push(scoop.join("apps").join("llvm").join("current").join("bin"));
        }
        dirs.dedup();
    } else {
        if let Ok(entries) = std::fs::read_dir("/usr/lib") {
            let mut versioned: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("llvm-"))
                })
                .collect();
            versioned.sort_by_key(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|n| n.trim_start_matches("llvm-").parse::<u32>().ok())
                    .unwrap_or(0)
            });
            dirs.extend(versioned.into_iter().rev().map(|p| p.join("bin")));
        }
        for dir in [
            "/opt/homebrew/opt/llvm/bin",
            "/usr/local/opt/llvm/bin",
            "/usr/local/bin",
            "/usr/bin",
        ] {
            let dir = PathBuf::from(dir);
            if !is_macos_shim(&dir.join("lldb-dap")) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

pub fn debugger_install_hint() -> &'static str {
    match std::env::consts::OS {
        "macos" => {
            "Install the Xcode Command Line Tools (`xcode-select --install`) or Xcode; both ship \
             lldb-dap. Alternatively install LLVM (`brew install llvm`). Set \
             VISCOSITY_LIVE_RE_LLDB_DAP to use a specific lldb-dap."
        }
        "windows" => {
            "Install LLVM for Windows (`winget install LLVM.LLVM`, or the installer from \
             https://github.com/llvm/llvm-project/releases); lldb-dap.exe lands in \
             C:\\Program Files\\LLVM\\bin. If lldb-dap.exe fails to start, install the Python \
             version that LLVM release was built against. Set VISCOSITY_LIVE_RE_LLDB_DAP to use a \
             specific lldb-dap."
        }
        _ => {
            "Install LLDB from your distribution or apt.llvm.org (`apt install lldb`, \
             `dnf install lldb`); it provides lldb-dap (lldb-vscode on older releases). Set \
             VISCOSITY_LIVE_RE_LLDB_DAP to use a specific lldb-dap."
        }
    }
}

/// Finds lldb-dap (or the older lldb-vscode).
pub fn find_debugger() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os(DEBUGGER_ENV).filter(|v| !v.is_empty()) {
        let path = PathBuf::from(explicit);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!(
                "{DEBUGGER_ENV} points to {}, which does not exist",
                path.display()
            ))
        };
    }
    if let Some(xcrun) = xcrun_path(developer_dir().as_deref())
        && let Some(path) = xcrun_find(&xcrun, "lldb-dap")
    {
        return Ok(path);
    }
    for name in ["lldb-dap", "lldb-vscode"] {
        if let Some(path) = which(name) {
            return Ok(path);
        }
    }
    for dir in llvm_dirs() {
        for name in ["lldb-dap", "lldb-vscode"] {
            let candidate = dir.join(exe_name(name));
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(format!(
        "lldb-dap was not found. {}",
        debugger_install_hint()
    ))
}

/// A found lldb-dap must also start: a missing Python or other library only
/// shows when it runs.
const DEBUGGER_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

/// Runs `lldb-dap --version`: `Ok(version)` when it started (or did not
/// answer in time), otherwise a stable reason code (`debugger-needs-python`,
/// `debugger-missing-library`, `debugger-failed`).
pub fn check_debugger(path: &Path) -> Result<Option<String>, &'static str> {
    #[cfg(windows)]
    suppress_loader_dialogs();
    classify_debugger_run(run_command(path, &["--version"], DEBUGGER_CHECK_TIMEOUT))
}

/// Children inherit the error mode, so a missing DLL makes them exit with a
/// status instead of blocking on a "code execution cannot proceed" dialog.
#[cfg(windows)]
fn suppress_loader_dialogs() {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetErrorMode(mode: u32) -> u32;
    }
    const SEM_FAILCRITICALERRORS: u32 = 0x0001;
    // SAFETY: SetErrorMode takes a flag set and has no memory effects.
    unsafe {
        let previous = SetErrorMode(SEM_FAILCRITICALERRORS);
        SetErrorMode(previous | SEM_FAILCRITICALERRORS);
    }
}

fn classify_debugger_run(
    run: Result<CommandOutput, String>,
) -> Result<Option<String>, &'static str> {
    // NTSTATUS exit codes of a process whose DLL imports did not resolve.
    const STATUS_DLL_NOT_FOUND: i32 = 0xC000_0135_u32 as i32;
    const STATUS_ENTRYPOINT_NOT_FOUND: i32 = 0xC000_0139_u32 as i32;
    let out = match run {
        Ok(out) => out,
        // `run_command`'s own timeout message. A cold start (or antivirus
        // scanning liblldb) can be slow, so a timeout is indeterminate, not broken.
        Err(error) if error.contains(" timed out after ") => return Ok(None),
        Err(_) => return Err("debugger-failed"),
    };
    let text = if out.stdout.trim().is_empty() {
        &out.stderr
    } else {
        &out.stdout
    };
    if out.success {
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .take(3)
            .collect();
        return Ok((!lines.is_empty()).then(|| lines.join("; ")));
    }
    let all = format!("{}\n{}", out.stdout, out.stderr).to_lowercase();
    // With loader dialogs suppressed a missing DLL prints nothing. liblldb.dll
    // ships next to lldb-dap.exe, so the missing one is python3XX.dll.
    if all.contains("python") || out.code == Some(STATUS_DLL_NOT_FOUND) {
        Err("debugger-needs-python")
    } else if out.code == Some(STATUS_ENTRYPOINT_NOT_FOUND)
        || all.contains("library not loaded")
        || all.contains("error while loading shared libraries")
    {
        Err("debugger-missing-library")
    } else if !all.trim().is_empty() && matches!(out.code, Some(1..=255)) {
        // It ran and only rejected `--version` (older lldb-vscode). Signals and
        // Windows NTSTATUS crash codes stay failures.
        Ok(None)
    } else {
        Err("debugger-failed")
    }
}

/// Agent-facing text for a `check_debugger` reason code.
pub fn debugger_problem_hint(reason: &str) -> &'static str {
    match reason {
        "debugger-needs-python" => {
            "lldb-dap was found but cannot load its Python library. Install the Python version \
             your LLDB/LLVM release was built against (on Windows, the python3XX.dll that LLVM \
             release links, for example Python 3.11 for python311.dll) and make sure its DLL is \
             on PATH. Reinstalling LLVM does not fix this."
        }
        "debugger-missing-library" => {
            "lldb-dap was found but a library it needs is missing. Reinstall LLDB/LLVM, or set \
             VISCOSITY_LIVE_RE_LLDB_DAP to a working lldb-dap."
        }
        _ => {
            "lldb-dap was found but could not start. Run `lldb-dap --version` by hand to see the \
             error, reinstall LLDB/LLVM, or set VISCOSITY_LIVE_RE_LLDB_DAP to a working lldb-dap."
        }
    }
}

/// adb from PATH, then the usual SDK and package-manager locations (a GUI
/// app's PATH often lacks them).
pub fn find_adb() -> Option<PathBuf> {
    if let Some(adb) = which("adb") {
        return Some(adb);
    }
    let env = |var: &str| std::env::var_os(var).map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .into_iter()
        .filter_map(env)
        .map(|sdk| sdk.join("platform-tools"))
        .collect();
    if cfg!(windows) {
        if let Some(local) = env("LOCALAPPDATA") {
            dirs.push(local.join("Android").join("Sdk").join("platform-tools"));
            // `winget install Google.PlatformTools` links adb.exe here.
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
        }
    } else {
        if let Some(home) = env("HOME") {
            dirs.push(home.join("Library/Android/sdk/platform-tools"));
            dirs.push(home.join("Android/Sdk/platform-tools"));
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs.into_iter()
        .map(|dir| dir.join(exe_name("adb")))
        .find(|candidate| candidate.is_file())
}

pub fn adb_hint() -> &'static str {
    "Install Android SDK Platform-Tools (https://developer.android.com/tools/releases/platform-tools; \
     macOS: `brew install --cask android-platform-tools`; Windows: `winget install Google.PlatformTools`) \
     and put adb on PATH."
}

fn apple_tool_hint(tool: &str) -> String {
    if cfg!(target_os = "macos") {
        format!(
            "{tool} ships with Xcode (not the Command Line Tools alone); install Xcode and run `sudo xcode-select -s /Applications/Xcode.app`."
        )
    } else {
        format!("{tool} is part of Xcode and only exists on macOS.")
    }
}

/// `simctl` / `devicectl` via xcrun, `adb` from PATH. Lookups only: adb is
/// never asked for devices here, because `adb devices` starts its daemon.
pub struct Tooling {
    pub developer_dir: Option<PathBuf>,
    pub xcrun: Option<PathBuf>,
    pub simctl: bool,
    pub devicectl: bool,
    pub adb: Option<PathBuf>,
}

pub fn tooling() -> Tooling {
    let developer_dir = developer_dir();
    let xcrun = xcrun_path(developer_dir.as_deref());
    let (simctl, devicectl) = match &xcrun {
        Some(xcrun) => (
            xcrun_find(xcrun, "simctl").is_some(),
            xcrun_find(xcrun, "devicectl").is_some(),
        ),
        None => (false, false),
    };
    Tooling {
        developer_dir,
        xcrun,
        simctl,
        devicectl,
        adb: find_adb(),
    }
}

fn host_os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    }
}

/// One read-only probe of this host, shared by `re_environment` and
/// `--environment`. Runs only: `xcode-select -p`, `xcrun -f` (after that),
/// `csrutil status`, `DevToolsSecurity -status`, `lldb-dap --version` and
/// `adb version`.
pub struct Probe {
    pub os: &'static str,
    pub debugger: Result<PathBuf, String>,
    pub debugger_version: Option<String>,
    /// Reason code when the found lldb-dap cannot start (`check_debugger`).
    pub debugger_problem: Option<&'static str>,
    pub tools: Tooling,
    pub adb_version: Option<String>,
    /// Raw `csrutil status` / `DevToolsSecurity -status` text (macOS only).
    pub csrutil: Option<String>,
    pub dev_tools_security: Option<String>,
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

pub fn probe() -> Probe {
    let os = host_os();
    let debugger = find_debugger();
    let (debugger_version, debugger_problem) = match debugger.as_ref().map(|p| check_debugger(p)) {
        Ok(Ok(version)) => (version, None),
        Ok(Err(reason)) => (None, Some(reason)),
        Err(_) => (None, None),
    };
    let tools = tooling();
    let adb_version = tools.adb.as_ref().and_then(|adb| {
        run_command(adb, &["version"], COMMAND_TIMEOUT)
            .ok()
            .filter(|o| o.success)
            .and_then(|o| first_line(&o.stdout))
    });
    let macos_status = |program: &str, arg: &str| {
        (os == "macos").then(|| {
            run_command(Path::new(program), &[arg], COMMAND_TIMEOUT)
                .map(|o| format!("{}{}", o.stdout, o.stderr).trim().to_string())
                .unwrap_or_else(|e| e)
        })
    };
    Probe {
        os,
        debugger,
        debugger_version,
        debugger_problem,
        tools,
        adb_version,
        csrutil: macos_status("/usr/bin/csrutil", "status"),
        dev_tools_security: macos_status("/usr/sbin/DevToolsSecurity", "-status"),
    }
}

/// `enabled` / `disabled` / `unknown` from `csrutil status` or
/// `DevToolsSecurity -status` text; `not-applicable` off macOS.
pub fn switch_state(text: Option<&str>) -> &'static str {
    let Some(text) = text else {
        return "not-applicable";
    };
    let text = text.to_lowercase();
    if text.contains("unknown") || text.contains("custom configuration") {
        "unknown"
    } else if text.contains("status: enabled") || text.contains("currently enabled") {
        "enabled"
    } else if text.contains("status: disabled") || text.contains("currently disabled") {
        "disabled"
    } else {
        "unknown"
    }
}

/// Agent-facing report for `re_environment` (free-form, with hints).
pub fn environment() -> Value {
    environment_from(&probe())
}

pub fn environment_from(probe: &Probe) -> Value {
    let os = probe.os;
    let tools = &probe.tools;
    let debugger_json = match &probe.debugger {
        Ok(path) => match probe.debugger_problem {
            None => json!({
                "found": true,
                "startable": true,
                "path": path.display().to_string(),
                "version": probe.debugger_version,
            }),
            Some(problem) => json!({
                "found": true,
                "startable": false,
                "path": path.display().to_string(),
                "problem": problem,
                "hint": debugger_problem_hint(problem),
            }),
        },
        Err(error) => json!({"found": false, "error": error, "hint": debugger_install_hint()}),
    };
    let have_debugger = probe.debugger.is_ok() && probe.debugger_problem.is_none();
    let sip = if os == "macos" {
        json!({
            "csrutil": probe.csrutil,
            "devToolsSecurity": probe.dev_tools_security,
            "developerDir": tools.developer_dir.as_ref().map(|p| p.display().to_string()),
            "note": "SIP blocks attaching to Apple-signed and hardened-runtime processes unless they \
                     carry com.apple.security.get-task-allow; your own unsigned or development builds \
                     can be debugged.",
        })
    } else {
        Value::Null
    };
    let tool = |found: bool, path: Option<String>, hint: String| {
        if found {
            json!({"found": true, "path": path})
        } else {
            json!({"found": false, "hint": hint})
        }
    };
    let xcrun_path = tools.xcrun.as_ref().map(|p| p.display().to_string());
    let device_tools = json!({
        "simctl": tool(tools.simctl, xcrun_path.clone().map(|p| format!("{p} simctl")), apple_tool_hint("simctl")),
        "devicectl": tool(tools.devicectl, xcrun_path.map(|p| format!("{p} devicectl")), apple_tool_hint("devicectl")),
        "adb": tool(tools.adb.is_some(), tools.adb.as_ref().map(|p| p.display().to_string()), adb_hint().to_string()),
    });
    let kind = |name: &str, available: bool, reason: &str| json!({"target": name, "available": available, "reason": reason});
    let no_debugger = if probe.debugger.is_ok() {
        "lldb-dap cannot start (see debugger.hint)"
    } else {
        "lldb-dap not found"
    };
    let local = kind(
        "local",
        have_debugger,
        if have_debugger {
            "attach to or launch host processes"
        } else {
            no_debugger
        },
    );
    let android = kind(
        "android",
        have_debugger && tools.adb.is_some(),
        if tools.adb.is_none() {
            "adb not found"
        } else if !have_debugger {
            no_debugger
        } else {
            "attach through an lldb-server you start on the device"
        },
    );
    let ios_device = kind(
        "ios-device",
        have_debugger && tools.devicectl,
        if !tools.devicectl {
            "devicectl (Xcode 15+) not found"
        } else if !have_debugger {
            no_debugger
        } else {
            "attach to development-signed apps (get-task-allow) on a paired device"
        },
    );
    let targets = match os {
        "macos" => vec![
            local,
            kind(
                "ios-simulator",
                have_debugger && tools.simctl,
                if !tools.simctl {
                    "simctl (Xcode) not found"
                } else if !have_debugger {
                    no_debugger
                } else {
                    "simulator apps are host processes"
                },
            ),
            ios_device,
            android,
        ],
        "windows" => vec![local, ios_device, android],
        _ => vec![local, android],
    };
    json!({
        "host": {"os": os, "arch": std::env::consts::ARCH},
        "debugger": debugger_json,
        "sip": sip,
        "deviceTools": device_tools,
        "targets": targets,
    })
}

fn target_state(state: &str, reason: &str) -> Value {
    json!({"state": state, "reason": reason})
}

/// `--environment`: the versioned report the desktop setup check reads
/// (`liveReEnvironmentSchema` in `src/shared/viscosity/liveRe.ts`). Stable
/// reason codes only; the app maps them to localized hints.
pub fn environment_report(probe: &Probe) -> Value {
    let os = probe.os;
    let tools = &probe.tools;
    let debugger = probe.debugger.is_ok();
    let sip = switch_state(probe.csrutil.as_deref());
    let tool_entry = |status: &str, path: Option<String>, version: Option<String>| {
        let mut tool = Map::new();
        tool.insert("status".into(), json!(status));
        if let Some(path) = path {
            tool.insert("path".into(), json!(path));
        }
        if let Some(version) = version {
            tool.insert("version".into(), json!(version));
        }
        Value::Object(tool)
    };
    let found = |path, version| tool_entry("found", path, version);
    let missing = || json!({"status": "missing"});
    let with_id = |id: &str, mut tool: Value| {
        tool["id"] = json!(id);
        tool
    };
    let mut list = vec![with_id(
        "lldb-dap",
        match &probe.debugger {
            // Present but not startable: neither found nor missing.
            Ok(path) => tool_entry(
                if probe.debugger_problem.is_some() {
                    "unknown"
                } else {
                    "found"
                },
                Some(path.display().to_string()),
                probe.debugger_version.clone(),
            ),
            Err(_) => missing(),
        },
    )];
    if os == "macos" {
        let xcrun = tools.xcrun.as_ref().map(|p| p.display().to_string());
        let apple = |available: bool, tool: &str| {
            if available {
                found(xcrun.as_ref().map(|p| format!("{p} {tool}")), None)
            } else {
                missing()
            }
        };
        list.push(with_id(
            "developer-dir",
            match &tools.developer_dir {
                Some(dir) => found(Some(dir.display().to_string()), None),
                None => missing(),
            },
        ));
        list.push(with_id("simctl", apple(tools.simctl, "simctl")));
        list.push(with_id("devicectl", apple(tools.devicectl, "devicectl")));
    }
    list.push(with_id(
        "adb",
        match &tools.adb {
            Some(adb) => found(Some(adb.display().to_string()), probe.adb_version.clone()),
            None => missing(),
        },
    ));

    let unavailable = |reason: &str| target_state("unavailable", reason);
    let need_debugger = |state: Value| match probe.debugger_problem {
        _ if !debugger => unavailable("no-debugger"),
        Some(problem) => target_state("limited", problem),
        None => state,
    };
    let macos = os == "macos";
    let targets = json!({
        "macosApps": if !macos {
            unavailable("other-os")
        } else if sip == "disabled" {
            need_debugger(target_state("ready", "ready"))
        } else {
            // SIP on (or unknown): own, ad-hoc and non-hardened builds only.
            need_debugger(target_state("limited", "sip-enabled"))
        },
        "iosSimulator": if !macos {
            unavailable("other-os")
        } else if tools.developer_dir.is_none() {
            unavailable("no-developer-dir")
        } else if !tools.simctl {
            unavailable("no-xcode")
        } else {
            need_debugger(target_state("ready", "ready"))
        },
        "iosDevice": if !macos {
            unavailable("other-os")
        } else if tools.developer_dir.is_none() {
            unavailable("no-developer-dir")
        } else if !tools.devicectl {
            unavailable("no-xcode")
        } else {
            need_debugger(target_state("limited", "development-signed-only"))
        },
        "android": if tools.adb.is_none() {
            unavailable("no-adb")
        } else {
            need_debugger(target_state("limited", "debuggable-apps-only"))
        },
        "windows": if os != "windows" {
            unavailable("other-os")
        } else {
            need_debugger(target_state("ready", "ready"))
        },
    });
    json!({
        "environmentVersion": crate::version::ENVIRONMENT_VERSION,
        "helperVersion": env!("CARGO_PKG_VERSION"),
        "protocolVersion": crate::version::TOOLS_PROTOCOL_VERSION,
        "host": {"os": os, "arch": std::env::consts::ARCH},
        "tools": list,
        "sip": sip,
        "devToolsSecurity": switch_state(probe.dev_tools_security.as_deref()),
        "targets": targets,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProcessInfo {
    pub pid: i64,
    pub name: String,
    pub path: Option<String>,
}

impl ProcessInfo {
    pub fn to_json(&self) -> Value {
        json!({"pid": self.pid, "name": self.name, "path": self.path})
    }
}

fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// Parses `lldb-dap --list-processes` JSON.
pub fn parse_lldb_dap_processes(text: &str) -> Option<Vec<ProcessInfo>> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let list = value.as_array()?;
    Some(
        list.iter()
            .filter_map(|p| {
                let pid = p.get("pid")?.as_i64()?;
                let path = p
                    .get("executable")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let name = p
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| path.as_deref().map(basename))?;
                Some(ProcessInfo { pid, name, path })
            })
            .collect(),
    )
}

/// Parses `ps -A -o pid= -o comm=` (macOS prints full paths in comm).
pub fn parse_ps(text: &str) -> Vec<ProcessInfo> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (pid, rest) = line.split_once(char::is_whitespace)?;
            let pid = pid.parse().ok()?;
            let command = rest.trim().to_string();
            let path = command.starts_with('/').then(|| command.clone());
            Some(ProcessInfo {
                pid,
                name: basename(&command),
                path,
            })
        })
        .collect()
}

/// Parses `tasklist /FO CSV /NH`: `"name","pid",...`.
pub fn parse_tasklist(text: &str) -> Vec<ProcessInfo> {
    text.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split("\",\"").map(|f| f.trim_matches('"')).collect();
            let pid = fields.get(1)?.parse().ok()?;
            Some(ProcessInfo {
                pid,
                name: fields.first()?.to_string(),
                path: None,
            })
        })
        .collect()
}

/// Parses `adb shell ps -A` (toybox columns, NAME last, PID second).
pub fn parse_android_ps(text: &str) -> Vec<ProcessInfo> {
    text.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            let pid = cols.get(1)?.parse().ok()?;
            let name = cols.last()?.to_string();
            Some(ProcessInfo {
                pid,
                name,
                path: None,
            })
        })
        .collect()
}

pub fn local_processes() -> Result<Vec<ProcessInfo>, String> {
    if let Ok(debugger) = find_debugger()
        && let Ok(out) = run_command(&debugger, &["--list-processes"], COMMAND_TIMEOUT)
        && out.success
        && let Some(list) = parse_lldb_dap_processes(&out.stdout)
    {
        return Ok(list);
    }
    // Older lldb-dap builds lack --list-processes.
    if cfg!(windows) {
        let tasklist = which("tasklist").unwrap_or_else(|| PathBuf::from("tasklist"));
        let out = run_command(&tasklist, &["/FO", "CSV", "/NH"], COMMAND_TIMEOUT)?;
        Ok(parse_tasklist(&out.stdout))
    } else {
        let ps = which("ps").unwrap_or_else(|| PathBuf::from("/bin/ps"));
        let out = run_command(&ps, &["-A", "-o", "pid=", "-o", "comm="], COMMAND_TIMEOUT)?;
        Ok(parse_ps(&out.stdout))
    }
}

/// Parses `ps -A -o pid= -o ppid=` into pid → parent pid.
pub fn parse_ppid(text: &str) -> HashMap<i64, i64> {
    text.lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            Some((cols.next()?.parse().ok()?, cols.next()?.parse().ok()?))
        })
        .collect()
}

#[cfg(unix)]
fn parent_map() -> HashMap<i64, i64> {
    let ps = which("ps").unwrap_or_else(|| PathBuf::from("/bin/ps"));
    run_command(&ps, &["-A", "-o", "pid=", "-o", "ppid="], COMMAND_TIMEOUT)
        .map(|out| parse_ppid(&out.stdout))
        .unwrap_or_default()
}

#[cfg(windows)]
fn parent_map() -> HashMap<i64, i64> {
    // PROCESSENTRY32W from tlhelp32.h.
    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        process_id: u32,
        default_heap_id: usize,
        module_id: u32,
        threads: u32,
        parent_process_id: u32,
        priority: i32,
        flags: u32,
        exe_file: [u16; 260],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
        fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    let mut map = HashMap::new();
    // SAFETY: documented Toolhelp usage; `entry` is a correctly sized, zeroed
    // PROCESSENTRY32W and the snapshot handle is closed before returning.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == -1 {
            return map;
        }
        let mut entry: ProcessEntry = std::mem::zeroed();
        entry.size = std::mem::size_of::<ProcessEntry>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            map.insert(
                i64::from(entry.process_id),
                i64::from(entry.parent_process_id),
            );
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    map
}

/// Walks `start` up through `parents`, stopping at pid 1/0, a loop, or 64 hops.
pub fn ancestry(start: i64, parents: &HashMap<i64, i64>) -> Vec<i64> {
    let mut chain = vec![start];
    while let Some(&parent) = chain.last().and_then(|pid| parents.get(pid)) {
        if parent <= 1 || chain.contains(&parent) || chain.len() >= 64 {
            break;
        }
        chain.push(parent);
    }
    chain
}

/// This server and every ancestor (agent CLI, app host). Stopping any of
/// them under the debugger would freeze the caller with no way to resume.
pub fn self_and_ancestors() -> Vec<i64> {
    let chain = ancestry(i64::from(std::process::id()), &parent_map());
    #[cfg(unix)]
    let chain = {
        let mut chain = chain;
        let parent = i64::from(std::os::unix::process::parent_id());
        if parent > 1 && !chain.contains(&parent) {
            chain.push(parent);
        }
        chain
    };
    chain
}

fn require_adb() -> Result<PathBuf, String> {
    find_adb().ok_or_else(|| format!("adb was not found. {}", adb_hint()))
}

fn require_xcrun_tool(tool: &str, tools: Tooling) -> Result<PathBuf, String> {
    let available = if tool == "simctl" {
        tools.simctl
    } else {
        tools.devicectl
    };
    match tools.xcrun {
        Some(xcrun) if available => Ok(xcrun),
        _ => Err(format!(
            "{tool} is not available. {}",
            apple_tool_hint(tool)
        )),
    }
}

fn adb_args<'a>(device_id: Option<&'a str>, rest: &[&'a str]) -> Vec<&'a str> {
    let mut args = Vec::new();
    if let Some(id) = device_id {
        args.extend(["-s", id]);
    }
    args.extend_from_slice(rest);
    args
}

pub fn android_processes(device_id: Option<&str>) -> Result<Vec<ProcessInfo>, String> {
    let adb = require_adb()?;
    let out = run_command(
        &adb,
        &adb_args(device_id, &["shell", "ps", "-A"]),
        COMMAND_TIMEOUT,
    )?;
    if !out.success {
        return Err(format!("adb shell ps failed: {}", out.stderr.trim()));
    }
    Ok(parse_android_ps(&out.stdout))
}

/// Simulator apps run as host processes from the CoreSimulator device tree.
pub fn simulator_processes(device_id: Option<&str>) -> Result<Vec<ProcessInfo>, String> {
    let needle = match device_id {
        Some(id) => format!("CoreSimulator/Devices/{id}/"),
        None => "CoreSimulator/".to_string(),
    };
    Ok(local_processes()?
        .into_iter()
        .filter(|p| p.path.as_deref().is_some_and(|path| path.contains(&needle)))
        .collect())
}

/// Runs a devicectl command that writes its JSON result to a temp file.
fn devicectl_json(args: &[&str]) -> Result<Value, String> {
    let xcrun = require_xcrun_tool("devicectl", tooling())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file = std::env::temp_dir().join(format!(
        "viscosity-live-re-{}-{nanos}.json",
        std::process::id()
    ));
    let file_arg = file.display().to_string();
    let mut full = vec!["devicectl"];
    full.extend_from_slice(args);
    full.extend(["--json-output", file_arg.as_str()]);
    let out = run_command(&xcrun, &full, Duration::from_secs(30));
    let text = std::fs::read_to_string(&file);
    let _ = std::fs::remove_file(&file);
    let out = out?;
    match text {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("devicectl JSON: {e}")),
        Err(_) => Err(format!("devicectl failed: {}", out.stderr.trim())),
    }
}

pub fn ios_device_processes(device_id: Option<&str>) -> Result<Vec<ProcessInfo>, String> {
    let id = device_id.ok_or("deviceId is required for ios-device (see re_list_devices)")?;
    let value = devicectl_json(&["device", "info", "processes", "--device", id])?;
    let list = value
        .pointer("/result/runningProcesses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(list
        .iter()
        .filter_map(|p| {
            let pid = p.get("processIdentifier")?.as_i64()?;
            let path = p
                .get("executable")
                .and_then(Value::as_str)
                .map(|s| s.trim_start_matches("file://").to_string());
            let name = path.as_deref().map(basename).unwrap_or_default();
            Some(ProcessInfo { pid, name, path })
        })
        .collect())
}

pub fn list_processes(target: &str, device_id: Option<&str>) -> Result<Vec<ProcessInfo>, String> {
    match target {
        "local" => local_processes(),
        "android" => android_processes(device_id),
        "ios-simulator" => simulator_processes(device_id),
        "ios-device" => ios_device_processes(device_id),
        other => Err(format!("unknown target {other:?}")),
    }
}

pub fn parse_adb_devices(text: &str) -> Vec<Value> {
    text.lines()
        .skip_while(|l| !l.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            let details: serde_json::Map<String, Value> = parts
                .filter_map(|kv| kv.split_once(':'))
                .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
                .collect();
            Some(json!({"id": serial, "state": state, "details": details}))
        })
        .collect()
}

pub fn list_devices() -> Value {
    let tools = tooling();
    let simulators = match (&tools.xcrun, tools.simctl) {
        (Some(xcrun), true) => match run_command(
            xcrun,
            &["simctl", "list", "devices", "--json"],
            COMMAND_TIMEOUT,
        ) {
            Ok(out) => match serde_json::from_str::<Value>(&out.stdout) {
                Ok(value) => {
                    let mut list = Vec::new();
                    if let Some(map) = value.get("devices").and_then(Value::as_object) {
                        for (runtime, devices) in map {
                            for d in devices.as_array().into_iter().flatten() {
                                list.push(json!({
                                    "id": d.get("udid"), "name": d.get("name"), "state": d.get("state"),
                                    "available": d.get("isAvailable"), "runtime": runtime,
                                }));
                            }
                        }
                    }
                    json!({"available": true, "devices": list})
                }
                Err(e) => json!({"available": true, "error": format!("simctl JSON: {e}")}),
            },
            Err(e) => json!({"available": true, "error": e}),
        },
        _ => json!({"available": false, "hint": apple_tool_hint("simctl")}),
    };
    let ios_devices = if tools.devicectl {
        match devicectl_json(&["list", "devices"]) {
            Ok(value) => {
                let list: Vec<Value> = value
                    .pointer("/result/devices")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|d| {
                        json!({
                            "id": d.pointer("/hardwareProperties/udid").or_else(|| d.get("identifier")),
                            "identifier": d.get("identifier"),
                            "name": d.pointer("/deviceProperties/name"),
                            "os": d.pointer("/deviceProperties/osVersionNumber"),
                            "platform": d.pointer("/hardwareProperties/platform"),
                            "connection": d.pointer("/connectionProperties/tunnelState"),
                        })
                    })
                    .collect();
                json!({"available": true, "devices": list})
            }
            Err(e) => json!({"available": true, "error": e}),
        }
    } else {
        json!({"available": false, "hint": apple_tool_hint("devicectl")})
    };
    let android = match &tools.adb {
        Some(adb) => match run_command(adb, &["devices", "-l"], COMMAND_TIMEOUT) {
            Ok(out) => json!({"available": true, "devices": parse_adb_devices(&out.stdout)}),
            Err(e) => json!({"available": true, "error": e}),
        },
        None => json!({"available": false, "hint": adb_hint()}),
    };
    json!({"iosSimulators": simulators, "iosDevices": ios_devices, "android": android})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_process_lists() {
        let dap = r#"[{"pid":5,"name":"a","executable":"/x/a"},{"pid":6,"executable":"/y/b"},{"name":"nopid"}]"#;
        let list = parse_lldb_dap_processes(dap).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].name, "b");
        assert!(parse_lldb_dap_processes("usage: lldb-dap").is_none());

        let ps = "  1 /sbin/launchd\n 42 bash\nbad line\n";
        let list = parse_ps(ps);
        assert_eq!(
            list[0],
            ProcessInfo {
                pid: 1,
                name: "launchd".into(),
                path: Some("/sbin/launchd".into())
            }
        );
        assert_eq!(list[1].path, None);
        assert_eq!(list.len(), 2);

        let tl = "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"\r\n\"app.exe\",\"1234\",\"Console\",\"1\",\"10,000 K\"\r\n";
        let list = parse_tasklist(tl);
        assert_eq!(list[1].pid, 1234);
        assert_eq!(list[1].name, "app.exe");

        let adb =
            "USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu0_a1 1234 1 100 10 0 0 S com.example.app\n";
        let list = parse_android_ps(adb);
        assert_eq!(
            list,
            vec![ProcessInfo {
                pid: 1234,
                name: "com.example.app".into(),
                path: None
            }]
        );
    }

    #[test]
    fn parses_adb_devices() {
        let text = "* daemon started\nList of devices attached\nemulator-5554  device product:sdk model:Pixel transport_id:1\n\n";
        let list = parse_adb_devices(text);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], "emulator-5554");
        assert_eq!(list[0]["details"]["model"], "Pixel");
    }

    #[test]
    fn run_command_reports_missing_program() {
        assert!(run_command(Path::new("/definitely/not/here"), &[], COMMAND_TIMEOUT).is_err());
    }

    fn synthetic(os: &'static str, debugger: bool, csrutil: Option<&str>) -> Probe {
        Probe {
            os,
            debugger: if debugger {
                Ok(PathBuf::from("/x/lldb-dap"))
            } else {
                Err("missing".into())
            },
            debugger_version: debugger.then(|| "lldb version 21".into()),
            debugger_problem: None,
            tools: Tooling {
                developer_dir: None,
                xcrun: None,
                simctl: false,
                devicectl: false,
                adb: Some(PathBuf::from("/x/adb")),
            },
            adb_version: Some("Android Debug Bridge version 1.0.41".into()),
            csrutil: csrutil.map(str::to_string),
            dev_tools_security: (os == "macos")
                .then(|| "Developer mode is currently disabled.".into()),
        }
    }

    #[test]
    fn environment_report_is_versioned_with_reason_codes() {
        let report = environment_report(&synthetic(
            "macos",
            true,
            Some("System Integrity Protection status: enabled."),
        ));
        assert_eq!(report["environmentVersion"], 1);
        assert_eq!(report["protocolVersion"], crate::TOOLS_PROTOCOL_VERSION);
        assert_eq!(report["sip"], "enabled");
        assert_eq!(report["devToolsSecurity"], "disabled");
        assert_eq!(report["targets"]["macosApps"]["state"], "limited");
        assert_eq!(report["targets"]["macosApps"]["reason"], "sip-enabled");
        assert_eq!(
            report["targets"]["iosSimulator"]["reason"],
            "no-developer-dir"
        );
        assert_eq!(report["targets"]["android"]["state"], "limited");
        assert_eq!(report["targets"]["windows"]["reason"], "other-os");
        let ids: Vec<&str> = report["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            ["lldb-dap", "developer-dir", "simctl", "devicectl", "adb"]
        );
        assert_eq!(report["tools"][0]["version"], "lldb version 21");
        assert_eq!(report["tools"][1]["status"], "missing");

        let report = environment_report(&synthetic("windows", false, None));
        assert_eq!(report["sip"], "not-applicable");
        assert_eq!(report["targets"]["windows"]["reason"], "no-debugger");
        assert_eq!(report["targets"]["android"]["reason"], "no-debugger");
        assert_eq!(report["targets"]["macosApps"]["reason"], "other-os");
        assert_eq!(report["tools"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn found_but_broken_debugger_is_not_ready() {
        let mut probe = synthetic("windows", true, None);
        probe.debugger_version = None;
        probe.debugger_problem = Some("debugger-needs-python");
        let report = environment_report(&probe);
        assert_eq!(report["tools"][0]["status"], "unknown");
        assert_eq!(report["tools"][0]["path"], "/x/lldb-dap");
        assert_eq!(report["targets"]["windows"]["state"], "limited");
        assert_eq!(
            report["targets"]["windows"]["reason"],
            "debugger-needs-python"
        );
        assert_eq!(report["targets"]["android"]["state"], "limited");
        assert_eq!(report["targets"]["macosApps"]["reason"], "other-os");
        let mut probe_no_adb = synthetic("windows", true, None);
        probe_no_adb.debugger_problem = Some("debugger-failed");
        probe_no_adb.tools.adb = None;
        assert_eq!(
            environment_report(&probe_no_adb)["targets"]["android"]["reason"],
            "no-adb"
        );

        let env = environment_from(&probe);
        assert_eq!(env["debugger"]["found"], true);
        assert_eq!(env["debugger"]["startable"], false);
        assert_eq!(env["debugger"]["problem"], "debugger-needs-python");
        assert!(env["debugger"]["hint"].as_str().unwrap().contains("Python"));
        assert_eq!(env["targets"][0]["available"], false);
    }

    fn output(success: bool, code: Option<i32>, stdout: &str, stderr: &str) -> CommandOutput {
        CommandOutput {
            success,
            code,
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }

    #[test]
    fn classifies_debugger_start() {
        assert_eq!(
            classify_debugger_run(Ok(output(true, Some(0), "lldb version 21.1.0\n", ""))),
            Ok(Some("lldb version 21.1.0".into()))
        );
        assert_eq!(
            classify_debugger_run(Ok(output(true, Some(0), "", ""))),
            Ok(None)
        );
        assert_eq!(
            classify_debugger_run(Ok(output(
                false,
                Some(1),
                "",
                "error: unable to find 'python311.dll'"
            ))),
            Err("debugger-needs-python")
        );
        assert_eq!(
            // Windows STATUS_DLL_NOT_FOUND: the loader prints nothing; it is python3XX.dll.
            classify_debugger_run(Ok(output(false, Some(0xC000_0135_u32 as i32), "", ""))),
            Err("debugger-needs-python")
        );
        assert_eq!(
            classify_debugger_run(Ok(output(false, Some(0xC000_0139_u32 as i32), "", ""))),
            Err("debugger-missing-library")
        );
        assert_eq!(
            classify_debugger_run(Ok(output(
                false,
                Some(127),
                "",
                "lldb-dap: error while loading shared libraries: liblldb.so.21"
            ))),
            Err("debugger-missing-library")
        );
        assert_eq!(
            classify_debugger_run(Ok(output(false, None, "", ""))),
            Err("debugger-failed")
        );
        assert_eq!(
            classify_debugger_run(Ok(output(false, Some(1), "", "unknown option --version"))),
            Ok(None)
        );
        assert_eq!(
            classify_debugger_run(Ok(output(false, None, "", "Abort trap: 6"))),
            Err("debugger-failed")
        );
        assert_eq!(
            classify_debugger_run(Ok(output(
                false,
                Some(0xC000_0005_u32 as i32),
                "",
                "access violation"
            ))),
            Err("debugger-failed")
        );
        assert_eq!(
            // A slow cold start is indeterminate, not broken.
            classify_debugger_run(Err("x timed out after 5 s".into())),
            Ok(None)
        );
        assert_eq!(
            classify_debugger_run(Err("could not run x: denied".into())),
            Err("debugger-failed")
        );
    }

    #[test]
    fn reads_switch_states() {
        assert_eq!(switch_state(None), "not-applicable");
        assert_eq!(
            switch_state(Some("System Integrity Protection status: disabled.")),
            "disabled"
        );
        assert_eq!(
            switch_state(Some(
                "System Integrity Protection status: unknown (Custom Configuration)."
            )),
            "unknown"
        );
        assert_eq!(
            switch_state(Some("Developer mode is currently enabled.")),
            "enabled"
        );
        assert_eq!(switch_state(Some("command not found")), "unknown");
    }

    #[test]
    fn never_reaches_xcrun_or_shims_without_a_developer_dir() {
        assert_eq!(xcrun_path(None), None);
        assert_eq!(
            is_macos_shim(Path::new("/usr/bin/lldb")),
            cfg!(target_os = "macos")
        );
        assert!(!is_macos_shim(Path::new(
            "/opt/homebrew/opt/llvm/bin/lldb-dap"
        )));
        assert!(
            llvm_dirs()
                .iter()
                .all(|d| !is_macos_shim(&d.join("lldb-dap")))
        );
        if let Some(path) = which("lldb") {
            assert!(!is_macos_shim(&path));
        }
    }

    #[test]
    fn walks_parent_chain() {
        let parents = parse_ppid("  10   1\n 20 10\n30 20\n 40 50\n 50 40\nbad line\n");
        assert_eq!(parents.len(), 5);
        assert_eq!(ancestry(30, &parents), vec![30, 20, 10]);
        assert_eq!(ancestry(40, &parents), vec![40, 50]);
        assert_eq!(ancestry(99, &parents), vec![99]);
        let own = self_and_ancestors();
        assert_eq!(own[0], i64::from(std::process::id()));
        #[cfg(unix)]
        assert!(own.contains(&i64::from(std::os::unix::process::parent_id())));
    }
}
