//! The shell's own loading and error pages, served as `data:` URLs: an opaque
//! origin outside the capability, so they get no IPC. Retry is a plain link the
//! navigation handler intercepts (see `navigation::RETRY_URL`).

use tauri::Url;

use crate::navigation::RETRY_URL;
use crate::sidecar::Failure;

const STYLE: &str = "color-scheme:light dark;font:14px/1.5 system-ui,sans-serif;\
                     max-width:46em;margin:12vh auto;padding:0 2em";

pub fn loading() -> Result<Url, String> {
    data_url(&format!(
        "<!doctype html><meta charset=utf-8><title>ViscosityCode</title>\
         <body style=\"{STYLE}\"><h2>Starting ViscosityCode…</h2>\
         <p>Starting the local server. This can take a few seconds.</p>"
    ))
}

pub fn error(failure: &Failure) -> Result<Url, String> {
    let (title, hint) = match failure {
        Failure::MissingRuntime(_) => (
            "The ViscosityCode server is missing",
            "This copy of the app is incomplete. Reinstall ViscosityCode. \
             For a development run, point VISCOSITY_TAURI_STANDALONE_DIR at an \
             extracted standalone archive.",
        ),
        Failure::OwnerBusy(_) => (
            "Another ViscosityCode app is using your data",
            "Another process (for example the ViscosityCode desktop app) owns this \
             data folder, and connecting to it failed. If it is still starting or \
             quitting, wait a moment and retry, or quit it first. Nothing in the \
             data folder was changed.",
        ),
        Failure::CredentialCustody(_) => (
            "This data folder was set up by the older ViscosityCode app",
            "The previous (Electron) ViscosityCode app sealed its saved credentials \
             with the macOS keychain, and this app cannot unseal them yet. Nothing \
             in the data folder was changed or deleted. Keep using the previous app \
             for this data until an update can migrate it.",
        ),
        Failure::Other(_) => (
            "ViscosityCode could not start",
            "Retry, or check the details below.",
        ),
    };
    data_url(&format!(
        "<!doctype html><meta charset=utf-8><title>ViscosityCode</title>\
         <body style=\"{STYLE}\"><h2>{title}</h2><p>{hint}</p>\
         <p><a href=\"{RETRY_URL}\" style=\"font-weight:600\">Retry</a></p>\
         <pre style=\"white-space:pre-wrap;opacity:.75\">{}</pre>",
        escape(failure.detail())
    ))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn data_url(html: &str) -> Result<Url, String> {
    let mut url = String::from("data:text/html;charset=utf-8,");
    for byte in html.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~ ".contains(&byte) {
            url.push(char::from(byte));
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    Url::parse(&url).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::navigation::{Action, on_navigation};

    fn decoded(url: &Url) -> String {
        let raw = url.as_str();
        let mut bytes = Vec::new();
        let mut rest = raw.as_bytes();
        while let [first, tail @ ..] = rest {
            if *first == b'%' && tail.len() >= 2 {
                let hex = std::str::from_utf8(&tail[..2]).unwrap();
                bytes.push(u8::from_str_radix(hex, 16).unwrap());
                rest = &tail[2..];
            } else {
                bytes.push(*first);
                rest = tail;
            }
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn error_page_is_an_inert_escaped_data_url() {
        let url = error(&Failure::Other("<script>x</script> & \"quoted\"".into())).unwrap();
        assert_eq!(url.scheme(), "data");
        let raw = url.as_str();
        assert!(!raw.contains('<') && !raw.contains('"'));
        assert!(raw.contains("%26lt%3Bscript%26gt%3B"), "{raw}");
        assert!(crate::loopback_url(raw).is_err());
        // Allowed only while no host is loaded.
        assert_eq!(on_navigation(&url, None), Action::Allow);
    }

    #[test]
    fn error_page_words_each_case_and_offers_retry() {
        for (failure, title) in [
            (
                Failure::MissingRuntime("Missing /x/runtime/node".into()),
                "The ViscosityCode server is missing",
            ),
            (
                Failure::OwnerBusy("pairings create failed".into()),
                "Another ViscosityCode app is using your data",
            ),
            (
                Failure::CredentialCustody("Credential mode change".into()),
                "This data folder was set up by the older ViscosityCode app",
            ),
            (
                Failure::Other("boom".into()),
                "ViscosityCode could not start",
            ),
        ] {
            let page = decoded(&error(&failure).unwrap());
            assert!(page.contains(title), "{page}");
            assert!(page.contains(failure.detail()), "{page}");
            assert!(page.contains(&format!("href=\"{RETRY_URL}\"")), "{page}");
        }
    }

    #[test]
    fn loading_page_is_a_shell_page() {
        let url = loading().unwrap();
        assert!(decoded(&url).contains("Starting ViscosityCode"));
        assert_eq!(on_navigation(&url, None), Action::Allow);
    }
}
