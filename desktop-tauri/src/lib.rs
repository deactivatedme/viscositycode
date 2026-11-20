//! ViscosityCode desktop shell: one window on the standalone host's loopback web
//! client. The window opens at once on a loading page; the shell starts the host
//! as a sidecar (`sidecar.rs`), or attaches to the process that already owns the
//! data root, then sends the window to a one-time pairing link, or to an error
//! page with Retry. `VC_TAURI_DEV_URL` skips the sidecar and opens that URL.

mod navigation;
mod owner;
mod page;
mod pairing;
mod sidecar;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::thread;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use navigation::Action;
use sidecar::Failure;

/// The window label the capability in `capabilities/main.json` grants.
pub const MAIN_WINDOW: &str = "main";
/// Pinned because the `http://127.0.0.1:<port>` origin keys the web client's
/// localStorage/IndexedDB and with it the paired session.
pub const DEFAULT_PORT: u16 = 49380;
/// The web client switches to the compact (mobile) layout at 767px and below.
const MIN_WIDTH: f64 = 1024.0;

pub type Error = Box<dyn std::error::Error>;

#[derive(Default)]
struct Shell {
    /// Where the window was sent once the host was known; `None` while the
    /// shell's own loading or error page shows. Drives `navigation::on_navigation`.
    host: Mutex<Option<Url>>,
    /// One startup at a time, so a double-clicked Retry cannot race itself.
    starting: AtomicBool,
    /// The `serve` child this shell owns; stopped on exit.
    slot: sidecar::Slot,
}

impl Shell {
    fn host(&self) -> Option<Url> {
        self.host
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn set_host(&self, host: Option<Url>) {
        *self.host.lock().unwrap_or_else(PoisonError::into_inner) = host;
    }
}

/// Accepts only `http://127.0.0.1:<port>/...`, the one origin the capability's
/// `remote.urls` admits; anything else must never get the shell's IPC.
pub fn loopback_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|error| format!("invalid URL {raw:?}: {error}"))?;
    let ok = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.username().is_empty()
        && url.password().is_none();
    if ok {
        Ok(url)
    } else {
        Err(format!(
            "refusing non-loopback URL {raw:?}; expected http://127.0.0.1:<port>/"
        ))
    }
}

/// Used by a second launch (single-instance) and the tray's Show.
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_external(app: &AppHandle, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("viscositycode-desktop: could not open {url}: {error}");
    }
}

fn open_main_window(app: &AppHandle, url: Url) -> tauri::Result<()> {
    let navigating = app.clone();
    let opening = app.clone();
    WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(url))
        .title("ViscosityCode")
        .inner_size(1280.0, 832.0)
        .min_inner_size(MIN_WIDTH, 640.0)
        // Keeps HTML5 drag-and-drop uploads working in the web client.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            let host = navigating
                .try_state::<Shell>()
                .and_then(|shell| shell.host());
            match navigation::on_navigation(url, host.as_ref()) {
                Action::Allow => true,
                Action::Retry => {
                    start(&navigating, true);
                    false
                }
                // `on_navigation` never opens externally; see its doc.
                Action::External | Action::Block => {
                    eprintln!("viscositycode-desktop: blocked navigation to {url}");
                    false
                }
            }
        })
        .on_new_window(move |url, _features| {
            match navigation::on_new_window(&url) {
                Action::External => open_external(&opening, &url),
                _ => eprintln!("viscositycode-desktop: blocked new window for {url}"),
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

/// Points the window at `url`; `host` marks it as the host rather than a shell page.
fn show(app: &AppHandle, url: Url, host: bool) -> Result<(), String> {
    let shell = app.try_state::<Shell>().ok_or("shell state is missing")?;
    shell.set_host(host.then(|| url.clone()));
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or("the main window is gone")?;
    window.navigate(url).map_err(|error| error.to_string())
}

/// Starts (or re-tries) the host off the main thread: startup can take seconds.
/// Also called from the navigation handler, so it must never block or navigate inline.
fn start(app: &AppHandle, show_loading: bool) {
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    if shell.starting.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let Some(shell) = app.try_state::<Shell>() else {
            return;
        };
        if show_loading && let Err(error) = page::loading().and_then(|url| show(&app, url, false)) {
            eprintln!("viscositycode-desktop: {error}");
        }
        let result = sidecar_config(&app)
            .map_err(Failure::from)
            .and_then(|config| sidecar::launch(&config, &shell.slot));
        let shown = match result {
            Ok(url) => show(&app, url, true),
            Err(failure) => {
                eprintln!("viscositycode-desktop: {}", failure.detail());
                page::error(&failure).and_then(|url| show(&app, url, false))
            }
        };
        if let Err(error) = shown {
            eprintln!("viscositycode-desktop: {error}");
        }
        shell.starting.store(false, Ordering::SeqCst);
    });
}

fn sidecar_config(app: &AppHandle) -> Result<sidecar::Config, String> {
    let paths = app.path();
    let dir = match std::env::var_os(sidecar::STANDALONE_DIR_ENV) {
        Some(dir) => dir.into(),
        None => paths
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("standalone"),
    };
    let home = paths.home_dir().map_err(|error| error.to_string())?;
    let log = paths
        .app_log_dir()
        .map_err(|error| error.to_string())?
        .join("standalone-server.log");
    Ok(sidecar::Config {
        dir,
        base_dir: sidecar::base_dir(std::env::var_os(sidecar::BASE_DIR_ENV), &home),
        port: DEFAULT_PORT,
        log,
    })
}

pub fn run() -> Result<(), Error> {
    // Validated before anything starts: a bad dev URL is a startup error.
    let dev_url = match std::env::var("VC_TAURI_DEV_URL").ok() {
        Some(raw) => Some(loopback_url(&raw)?),
        None => None,
    };
    let app = tauri::Builder::default()
        // Registered first so a second launch only focuses the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Its injected click script calls `plugin:opener|open_url`, which the
        // capability does not grant; links reach `on_new_window` instead.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .manage(Shell::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            match dev_url {
                Some(url) => {
                    if let Some(shell) = handle.try_state::<Shell>() {
                        shell.set_host(Some(url.clone()));
                    }
                    open_main_window(&handle, url)?;
                }
                None => {
                    open_main_window(&handle, page::loading()?)?;
                    start(&handle, false);
                }
            }
            if let Err(error) = tray::install(&handle) {
                eprintln!("viscositycode-desktop: no tray icon: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(|app, event| {
        if let RunEvent::Exit = event
            && let Some(shell) = app.try_state::<Shell>()
        {
            sidecar::shutdown(&shell.slot);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_http() {
        let url = loopback_url("http://127.0.0.1:3101/?pair=abc").unwrap();
        assert_eq!(url.port(), Some(3101));
        assert!(loopback_url("http://127.0.0.1/").is_ok());
    }

    #[test]
    fn rejects_everything_else() {
        for raw in [
            "https://127.0.0.1:3101/",
            "http://localhost:3101/",
            "http://[::1]:3101/",
            "http://127.0.0.2:3101/",
            "http://127.0.0.1.evil.com/",
            "http://user:pw@127.0.0.1:3101/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "not a url",
        ] {
            assert!(loopback_url(raw).is_err(), "{raw} must be refused");
        }
    }
}
