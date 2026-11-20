//! Classifies why `server.cjs serve` exited during startup, from its stderr.
//! The texts mirror `HostRootInUseError` (src/backend/ownership/hostOwnerLease.ts)
//! and `HostImportRequiredError` (src/backend/ownership/hostRootManifest.ts),
//! and the credential-custody refusals in src/backend/ownership/ownedSecretKey.ts.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartFailure {
    /// Another process (Electron, an orphaned server, a CLI `serve`) owns the
    /// root: attach to it as a client, never start a second writer.
    RootInUse,
    /// The namespace holds files the host will not adopt without an import.
    ImportRequired,
    /// The root's credential key is sealed by another mode, typically the
    /// Electron app's OS-sealed `secret-key.safe`; a headless `serve` will not
    /// adopt it without an explicit activation.
    CredentialCustody,
    Other,
}

/// ownedSecretKey.ts refusals that need an explicit ownership activation.
const CREDENTIAL_CUSTODY: [&str; 3] = [
    "Credential mode change requires explicit activation",
    "Stored credential key belongs to another mode",
    "Existing database credentials require explicit ownership activation",
];

pub fn classify(stderr: &str) -> StartFailure {
    if stderr.contains("already owns") && stderr.contains("before starting another owner") {
        StartFailure::RootInUse
    } else if stderr.contains("requires an explicit offline backup import") {
        StartFailure::ImportRequired
    } else if CREDENTIAL_CUSTODY.iter().any(|text| stderr.contains(text)) {
        StartFailure::CredentialCustody
    } else {
        StartFailure::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_known_refusals() {
        for guidance in [
            "Quit the running Poracode app that owns this profile before starting another owner",
            "Connect to the running Poracode host, or stop it, before starting another owner",
            "Stop the running owner before starting another owner",
        ] {
            let line = format!(
                "[poracode-server] Poracode already owns /Users/a/.viscositycode.host-v1. {guidance}; use a different PORACODE_BASE_DIR for a separate profile.\n"
            );
            assert_eq!(classify(&line), StartFailure::RootInUse);
        }
        let import = "[poracode-server] failed to start: HostImportRequiredError: Existing profile /Users/a/.viscositycode requires an explicit offline backup import before the owned host can use /Users/a/.viscositycode.host-v1. The original profile was not changed.\n    at ...";
        assert_eq!(classify(import), StartFailure::ImportRequired);
        // An Electron-created root (secret-key.safe); scripts/smoke.mjs checks the
        // real server prints the first line for such a root.
        for refusal in [
            "[poracode-server] failed to start: Error: Credential mode change requires explicit activation; the existing key was preserved.",
            "[poracode-server] failed to start: Error: Stored credential key belongs to another mode; the existing key was preserved.",
            "[poracode-server] failed to start: Error: Existing database credentials require explicit ownership activation; no key was created.",
        ] {
            assert_eq!(classify(refusal), StartFailure::CredentialCustody);
        }
        assert_eq!(
            classify("Error: listen EADDRINUSE: address already in use 127.0.0.1:49380"),
            StartFailure::Other
        );
        assert_eq!(classify(""), StartFailure::Other);
    }
}
