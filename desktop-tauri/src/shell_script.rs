//! The main-frame initialization script: tells the shared web client it runs in
//! this shell (`window.viscosityShell`) and gives it the system facts the
//! Electron preload exposes as `window.viscosityHost.system`
//! (`src/main/viscosity/system/systemInfoPreloadBridge.ts`): Lightweight mode's
//! memory and graphics hints, and the OS account name the profile row defaults to.

use std::sync::OnceLock;
use std::time::Duration;

/// Builds the script from the live system.
pub fn script() -> String {
    static USER_NAME: OnceLock<Option<String>> = OnceLock::new();
    let remote_desktop =
        cfg!(windows) && is_rdp_session(std::env::var("SESSIONNAME").ok().as_deref());
    // macOS keeps its memory-only Auto, like Electron: no WebGL probe there.
    build(
        total_memory_bytes(),
        remote_desktop,
        !cfg!(target_os = "macos"),
        USER_NAME.get_or_init(user_name).as_deref(),
    )
}

/// Electron's test: a Windows Remote Desktop session is named `RDP-...`.
fn is_rdp_session(name: Option<&str>) -> bool {
    name.and_then(|name| name.get(..4))
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rdp-"))
}

fn build(
    total_memory: Option<u64>,
    low_power_graphics: bool,
    probe_webgl: bool,
    user_name: Option<&str>,
) -> String {
    let memory = total_memory.map_or_else(|| "null".to_owned(), |bytes| bytes.to_string());
    // Optional, as in the preload: left out when the name is unknown. `<` is escaped so the
    // name stays inert even if a webview ever inlines this script into HTML.
    let user_name = user_name
        .and_then(|name| serde_json::to_string(name).ok())
        .map_or_else(String::new, |name| {
            format!(", userName: {}", name.replace('<', "\\u003c"))
        });
    // WebView2 runs initialization scripts in subframes too, so the guard keeps them main-frame only.
    format!(
        "if (window.top === window) {{\
         window.viscosityShell = Object.freeze({{ kind: \"tauri\", version: 1 }});\
         window.viscosityHost = Object.assign(window.viscosityHost || {{}}, {{ system: Object.freeze({{ \
         totalMemoryBytes: {memory}, lowPowerGraphics: {low_power_graphics}, probeWebGl: {probe_webgl}{user_name} \
         }}) }});\
         }}"
    )
}

/// The OS account's display name (macOS and Linux: the full name; Windows: the
/// display name), else the login name. It only goes into this window's page.
fn user_name() -> Option<String> {
    // A directory-bound account can make the lookup block: never hold up the launch for it.
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(display_name());
    });
    let display = receiver
        .recv_timeout(Duration::from_millis(500))
        .ok()
        .flatten()
        .and_then(|name| clean_user_name(&name));
    display.or_else(|| {
        let login = std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" }).ok()?;
        clean_user_name(&login)
    })
}

/// Trimmed, without control characters, at most 80 characters; `None` when empty.
fn clean_user_name(name: &str) -> Option<String> {
    let name: String = name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    let name = name.trim_end();
    (!name.is_empty()).then(|| name.to_owned())
}

#[cfg(unix)]
fn display_name() -> Option<String> {
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut buffer: [libc::c_char; 4096] = [0; 4096];
    let mut result = std::ptr::null_mut();
    // SAFETY: `entry` and `buffer` are valid for writes of the sizes passed, and `result` is a
    // valid out-pointer.
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &raw mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    // SAFETY: on success `result` points at the initialized `entry`.
    let gecos = unsafe { (*result).pw_gecos };
    if gecos.is_null() {
        return None;
    }
    // SAFETY: a non-null `pw_gecos` is a NUL-terminated string inside `buffer`, which is still alive.
    let gecos = unsafe { std::ffi::CStr::from_ptr(gecos) }.to_str().ok()?;
    // macOS stores the full name whole; elsewhere it is the first comma-separated GECOS field.
    let full_name = if cfg!(target_os = "macos") {
        gecos
    } else {
        gecos.split(',').next()?
    };
    Some(full_name.to_owned())
}

#[cfg(windows)]
fn display_name() -> Option<String> {
    use windows_sys::Win32::Security::Authentication::Identity::{GetUserNameExW, NameDisplay};
    let mut buffer = [0u16; 256];
    let mut len = u32::try_from(buffer.len()).ok()?;
    // SAFETY: `buffer` is valid for writes of `len` UTF-16 units, as the API requires.
    let ok = unsafe { GetUserNameExW(NameDisplay, buffer.as_mut_ptr(), &raw mut len) };
    // It fails for an account with no full name: the caller falls back to the login name.
    if !ok {
        return None;
    }
    Some(String::from_utf16_lossy(
        buffer.get(..usize::try_from(len).ok()?)?,
    ))
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
            build(Some(17_179_869_184), true, false, None),
            "if (window.top === window) {\
             window.viscosityShell = Object.freeze({ kind: \"tauri\", version: 1 });\
             window.viscosityHost = Object.assign(window.viscosityHost || {}, { system: Object.freeze({ \
             totalMemoryBytes: 17179869184, lowPowerGraphics: true, probeWebGl: false }) });}"
        );
        assert!(
            build(None, false, true, None)
                .contains("totalMemoryBytes: null, lowPowerGraphics: false, probeWebGl: true")
        );
    }

    #[test]
    fn script_adds_the_user_name_as_a_json_string_only_when_known() {
        assert!(!build(None, false, true, None).contains("userName"));
        assert!(
            build(None, false, true, Some("Sam \"Q\" O'Neil</script>\\")).contains(
                r#"probeWebGl: true, userName: "Sam \"Q\" O'Neil\u003c/script>\\" }) });}"#
            )
        );
    }

    #[test]
    fn cleans_user_names() {
        assert_eq!(clean_user_name("  Sam Doe \n"), Some("Sam Doe".to_owned()));
        assert_eq!(clean_user_name("Sam\u{0}\tDoe"), Some("SamDoe".to_owned()));
        assert_eq!(clean_user_name(" \t "), None);
        assert_eq!(
            clean_user_name(&"x".repeat(200)).map(|name| name.chars().count()),
            Some(80)
        );
    }

    #[test]
    fn reads_the_user_name_on_shipped_platforms() {
        if cfg!(any(target_os = "macos", windows)) {
            assert!(user_name().is_some());
        }
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
