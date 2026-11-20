// Kept at the historical key so an existing opt-out survives the upgrade from
// the three-way "thread only / thread + worktree" dialog to a single confirm.
const PREF_KEY = "poracode-delete-worktree-pref";

// ViscosityCode: deleting does not ask unless the user turned confirmation on
// (Settings → Threads). Upstream asks by default.
const ASK = "ask";

export function shouldConfirmThreadDelete(): boolean {
  // The older UI's "thread-only" never authorised worktree removal, so it
  // still asks; only that value and an explicit opt-in confirm.
  const stored = localStorage.getItem(PREF_KEY);
  return stored === ASK || stored === "thread-only";
}

export function setConfirmThreadDelete(confirm: boolean): void {
  localStorage.setItem(PREF_KEY, confirm ? ASK : "thread-and-worktree");
}
