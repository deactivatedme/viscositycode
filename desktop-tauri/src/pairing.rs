//! One-time pairing link for the window: `server.cjs pairings create --json`
//! against whichever process owns the data root (our sidecar or an existing owner).

use std::ffi::OsString;
use std::path::Path;

use tauri::Url;

use crate::loopback_url;

/// Arguments after the node binary. A short TTL is enough: the window loads
/// the link right away and the credential is single-use.
pub fn create_args(server_cjs: &Path) -> Vec<OsString> {
    let mut args = vec![server_cjs.as_os_str().to_owned()];
    args.extend(
        [
            "pairings",
            "create",
            "--preset",
            "operator",
            "--label",
            "ViscosityCode window",
            "--ttl",
            "1m",
            "--json",
        ]
        .map(OsString::from),
    );
    args
}

/// Reads `localPairingUrl` from the JSON line, or the `{ok:false,error}` refusal.
/// The link must stay on loopback http, the only origin the window may load.
pub fn parse(stdout: &str) -> Result<Url, String> {
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{'))
        .ok_or_else(|| format!("pairings create printed no JSON: {:?}", stdout.trim()))?;
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| format!("pairings create printed invalid JSON: {error}"))?;
    if let Some(url) = value.get("localPairingUrl").and_then(|url| url.as_str()) {
        return loopback_url(url);
    }
    let reason = value
        .get("error")
        .and_then(|error| error.as_str())
        .unwrap_or("no localPairingUrl in the response");
    Err(format!("pairing failed: {reason}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_create_args() {
        let args = create_args(Path::new("/s/lib/server.cjs"));
        let args: Vec<_> = args.iter().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(
            args,
            [
                "/s/lib/server.cjs",
                "pairings",
                "create",
                "--preset",
                "operator",
                "--label",
                "ViscosityCode window",
                "--ttl",
                "1m",
                "--json"
            ]
        );
    }

    #[test]
    fn parses_local_pairing_url() {
        let out = r#"{"id":"g1","pairingUrl":"https://relay.example/#pair=x","localPairingUrl":"http://127.0.0.1:49380/#pair=abc","expiresAt":"2026-11-20T00:01:00Z","scopes":["session:read"]}"#;
        let url = parse(&format!("notice\n{out}\n")).unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:49380/#pair=abc");
    }

    #[test]
    fn refuses_bad_responses() {
        let refused = parse(r#"{"ok":false,"error":"Owner control is unavailable."}"#);
        assert_eq!(
            refused.unwrap_err(),
            "pairing failed: Owner control is unavailable."
        );
        assert!(parse(r#"{"localPairingUrl":"https://127.0.0.1:49380/#pair=a"}"#).is_err());
        assert!(parse(r#"{"localPairingUrl":"http://192.168.1.2:49380/#pair=a"}"#).is_err());
        assert!(parse(r#"{"id":"g1"}"#).is_err());
        assert!(parse("{not json").is_err());
        assert!(parse("").is_err());
    }
}
