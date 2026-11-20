//! The main-frame initialization script: tells the shared web client it runs in
//! this shell (`window.viscosityShell`) and gives Lightweight mode the system
//! facts the Electron preload exposes as `window.viscosityHost.system`
//! (`src/main/viscosity/system/systemInfoPreloadBridge.ts`).

/// Builds the script from the live system.
pub fn script() -> String {
    let remote_desktop =
        cfg!(windows) && is_rdp_session(std::env::var("SESSIONNAME").ok().as_deref());
    // macOS keeps its memory-only Auto, like Electron: no WebGL probe there.
    build(
        total_memory_bytes(),
        remote_desktop,
        !cfg!(target_os = "macos"),
    )
}

/// Electron's test: a Windows Remote Desktop session is named `RDP-...`.
fn is_rdp_session(name: Option<&str>) -> bool {
    name.and_then(|name| name.get(..4))
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rdp-"))
}

fn build(total_memory: Option<u64>, low_power_graphics: bool, probe_webgl: bool) -> String {
    let memory = total_memory.map_or_else(|| "null".to_owned(), |bytes| bytes.to_string());
    // WebView2 runs initialization scripts in subframes too, so the guard keeps them main-frame only.
    format!(
        "if (window.top === window) {{\
         window.viscosityShell = Object.freeze({{ kind: \"tauri\", version: 1 }});\
         window.viscosityHost = Object.assign(window.viscosityHost || {{}}, {{ system: Object.freeze({{ \
         totalMemoryBytes: {memory}, lowPowerGraphics: {low_power_graphics}, probeWebGl: {probe_webgl} \
         }}) }});\
         }}"
    )
}

#[cfg(target_os = "macos")]
fn total_memory_bytes() -> Option<u64> {
    let mut bytes: u64 = 0;
    let mut len = size_of::<u64>();
    // SAFETY: `hw.memsize` is a u64, and `len` is the size of the buffer `bytes` points to.
    let status = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&raw mut bytes).cast(),
            &raw mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (status == 0 && bytes > 0).then_some(bytes)
}

#[cfg(windows)]
fn total_memory_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: u32::try_from(size_of::<MEMORYSTATUSEX>()).ok()?,
        ..Default::default()
    };
    // SAFETY: `status` is a valid MEMORYSTATUSEX with `dwLength` set, as the API requires.
    let ok = unsafe { GlobalMemoryStatusEx(&raw mut status) } != 0;
    (ok && status.ullTotalPhys > 0).then_some(status.ullTotalPhys)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn total_memory_bytes() -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_defines_the_shell_and_merges_system_facts() {
        assert_eq!(
            build(Some(17_179_869_184), true, false),
            "if (window.top === window) {\
             window.viscosityShell = Object.freeze({ kind: \"tauri\", version: 1 });\
             window.viscosityHost = Object.assign(window.viscosityHost || {}, { system: Object.freeze({ \
             totalMemoryBytes: 17179869184, lowPowerGraphics: true, probeWebGl: false }) });}"
        );
        assert!(
            build(None, false, true)
                .contains("totalMemoryBytes: null, lowPowerGraphics: false, probeWebGl: true")
        );
    }

    #[test]
    fn detects_remote_desktop_sessions() {
        for name in ["RDP-Tcp#0", "rdp-tcp#12", "Rdp-x"] {
            assert!(is_rdp_session(Some(name)), "{name}");
        }
        for name in [
            None,
            Some(""),
            Some("Console"),
            Some("RDP"),
            Some("xRDP-Tcp"),
        ] {
            assert!(!is_rdp_session(name), "{name:?}");
        }
    }

    #[test]
    fn reads_total_memory_on_shipped_platforms() {
        if cfg!(any(target_os = "macos", windows)) {
            assert!(total_memory_bytes().is_some_and(|bytes| bytes >= 1 << 30));
        }
    }
}
