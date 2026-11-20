//! `viscosity-live-re` entry point: `--hello` handshake, `--environment`
//! setup report, otherwise MCP on stdin/stdout until EOF or SIGINT/SIGTERM,
//! then every session is closed.

use std::io;
use std::process::ExitCode;
#[cfg(unix)]
use std::sync::Arc;
use viscosity_live_re::host;
use viscosity_live_re::mcp::{SUPPORTED_PROTOCOL_VERSIONS, Server};
use viscosity_live_re::version::{PROTOCOL_ENV, TOOLS_PROTOCOL_VERSION};

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn hello_line() -> String {
    serde_json::json!({
        "helper": "viscosity-live-re",
        "helperVersion": env!("CARGO_PKG_VERSION"),
        "protocolVersion": TOOLS_PROTOCOL_VERSION,
        "mcpProtocolVersions": SUPPORTED_PROTOCOL_VERSIONS,
        "platform": platform_name(),
        "arch": arch_name(),
    })
    .to_string()
}

#[cfg(unix)]
mod signals {
    use super::*;
    use std::ffi::c_int;
    use std::thread;

    /// Blocks SIGINT/SIGTERM before any thread spawns so `sigwait` gets them.
    pub fn block() -> libc::sigset_t {
        // SAFETY: sigset_t is a plain bitmask; sigemptyset initializes it.
        let mut set: libc::sigset_t = unsafe { std::mem::zeroed() };
        unsafe {
            libc::sigemptyset(&mut set);
            libc::sigaddset(&mut set, libc::SIGINT);
            libc::sigaddset(&mut set, libc::SIGTERM);
            libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        }
        set
    }

    pub fn watch(server: Arc<Server>, set: libc::sigset_t) {
        thread::spawn(move || {
            let mut signal: c_int = 0;
            // SAFETY: `set` is initialized and outlives the call.
            if unsafe { libc::sigwait(&set, &mut signal) } != 0 {
                unsafe {
                    libc::pthread_sigmask(libc::SIG_UNBLOCK, &set, std::ptr::null_mut());
                }
                return;
            }
            server.shutdown();
            std::process::exit(0);
        });
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => {}
        [flag] if flag == "--hello" => {
            println!("{}", hello_line());
            return ExitCode::SUCCESS;
        }
        [flag] if flag == "--environment" => {
            println!("{}", host::environment_report(&host::probe()));
            return ExitCode::SUCCESS;
        }
        other => {
            eprintln!(
                "viscosity-live-re: unknown arguments {other:?}; run with no arguments for MCP over stdio, --hello or --environment"
            );
            return ExitCode::from(2);
        }
    }
    // Fail closed when the host speaks another tool contract (a stale staged
    // binary); unset means a manual run.
    if let Some(requested) = std::env::var_os(PROTOCOL_ENV)
        && requested.to_str().map(str::trim) != Some(TOOLS_PROTOCOL_VERSION.to_string().as_str())
    {
        eprintln!(
            "viscosity-live-re: the host expects tool protocol {requested:?} but this helper speaks {TOOLS_PROTOCOL_VERSION}; update ViscosityCode or rebuild the helper"
        );
        return ExitCode::from(3);
    }

    #[cfg(unix)]
    let signal_set = signals::block();

    let server = Server::new(Box::new(io::stdout()));
    #[cfg(unix)]
    signals::watch(Arc::clone(&server), signal_set);

    // shortcut: on Windows a hard kill skips close_all; lldb-dap then sees stdin
    // EOF and exits. Add a kill-on-close job object if orphans show up.
    server.run(io::stdin().lock());
    server.shutdown();
    ExitCode::SUCCESS
}
