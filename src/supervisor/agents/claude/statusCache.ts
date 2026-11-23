// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
// v68 adds read-only one-shot workspaces; v70 changes the default context window;
// v71 moves ultracode from an effort tier to the `workflowModels` toggle.
// Includes configured profiles, whose capabilities derive from the same adapter.
// ViscosityCode: v82 drops rows holding the stale static model list and the old
// "Max Subscription" plan label for Ultra (Max 20x) accounts.
// v83 refreshes executable selection after detecting shadowed 1.x installations.
export const claudeStatusCachePolicy = { kind: "claude", minimumVersion: 83 };
