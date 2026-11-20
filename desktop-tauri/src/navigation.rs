//! What the main webview may load. Only the host origin and the shell's own
//! pages stay in the window. Every other navigation is refused, as Electron's
//! guard in src/main/window/windowHardening.ts does; only `window.open` and
//! `target=_blank` (the web client's openExternal stand-in) reach the browser.

use tauri::Url;

/// The error page's Retry link. Never loaded: the navigation handler cancels
/// it and restarts the host. `.invalid` cannot resolve if a handler is missed.
pub const RETRY_URL: &str = "http://retry.viscositycode.invalid/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Allow,
    Retry,
    /// Cancel here and open in the system browser.
    External,
    Block,
}

/// `host` is the URL the window was pointed at once the host was known;
/// `None` while the shell's own loading or error page is showing.
///
/// macOS (wry) also runs this for subframes, so the frames the web client
/// creates itself must pass: `about:blank`/`about:srcdoc`, and the host's MCP
/// sandbox, which is same-origin. wry says neither which frame navigates nor
/// whether a user started it, so an off-origin target is blocked, never opened:
/// otherwise a script in an MCP app or HTML visual could open any URL in the
/// system browser without a click.
pub fn on_navigation(url: &Url, host: Option<&Url>) -> Action {
    if is_retry(url) {
        return if host.is_none() {
            Action::Retry
        } else {
            Action::Block
        };
    }
    let allowed = match host {
        Some(host) => url.origin() == host.origin(),
        // The shell's loading and error pages.
        None => url.scheme() == "data",
    };
    if allowed || matches!(url.as_str(), "about:blank" | "about:srcdoc") {
        Action::Allow
    } else {
        Action::Block
    }
}

/// `window.open` and `target=_blank`: never a second webview.
pub fn on_new_window(url: &Url) -> Action {
    if is_external(url) {
        Action::External
    } else {
        Action::Block
    }
}

fn is_external(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
        && url.username().is_empty()
        && url.password().is_none()
        && !is_retry(url)
}

fn is_retry(url: &Url) -> bool {
    url.as_str() == RETRY_URL
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).unwrap()
    }

    #[test]
    fn keeps_the_host_origin_in_the_window() {
        let host = url("http://127.0.0.1:49380/?pair=abc");
        for same in [
            "http://127.0.0.1:49380/",
            "http://127.0.0.1:49380/thread/1#x",
            "http://127.0.0.1:49380/mcp-apps/sandbox/v1",
            "about:blank",
            "about:srcdoc",
            // WHATWG: a blob URL has its creator's origin.
            "blob:http://127.0.0.1:49380/uuid",
        ] {
            assert_eq!(
                on_navigation(&url(same), Some(&host)),
                Action::Allow,
                "{same}"
            );
        }
    }

    #[test]
    fn sends_only_new_windows_to_the_browser() {
        let host = url("http://127.0.0.1:49380/");
        for other in [
            "https://github.com/a/b",
            "http://127.0.0.1:5173/",
            "http://localhost:49380/",
            "https://127.0.0.1:49380/",
            "mailto:a@b.c",
        ] {
            // A navigation may come from an untrusted subframe script: refuse it.
            assert_eq!(
                on_navigation(&url(other), Some(&host)),
                Action::Block,
                "{other}"
            );
            assert_eq!(on_new_window(&url(other)), Action::External, "{other}");
        }
    }

    #[test]
    fn blocks_everything_else() {
        let host = url("http://127.0.0.1:49380/");
        for other in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<p>x",
            "about:config",
            "blob:https://example.com/uuid",
            "vscode://file/x",
            "http://user:pw@example.com/",
            RETRY_URL,
        ] {
            assert_eq!(
                on_navigation(&url(other), Some(&host)),
                Action::Block,
                "{other}"
            );
            assert_eq!(on_new_window(&url(other)), Action::Block, "{other}");
        }
        // Same-origin new windows still never become a second webview.
        assert_eq!(
            on_new_window(&url("http://127.0.0.1:49380/x")),
            Action::External
        );
    }

    #[test]
    fn shell_pages_allow_data_and_retry_only() {
        assert_eq!(on_navigation(&url("data:text/html,x"), None), Action::Allow);
        assert_eq!(on_navigation(&url(RETRY_URL), None), Action::Retry);
        assert_eq!(
            on_navigation(&url("https://example.com/"), None),
            Action::Block
        );
        assert_eq!(
            on_navigation(&url("file:///etc/passwd"), None),
            Action::Block
        );
    }
}
