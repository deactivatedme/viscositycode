/**
 * ViscosityCode: who the sidebar profile row shows. Provider-agnostic: the
 * first successful usage snapshot (in the model picker's provider order)
 * that names an account or a plan.
 */
import type { UsageSnapshot } from "@/shared/contracts";

export interface ProfileIdentity {
  /** Local part of the signed-in account, or null for the generic "Account". */
  name: string | null;
  plan: string | null;
}

export function pickProfileIdentity(
  snapshots: Readonly<Record<string, UsageSnapshot>>,
  rank: (providerId: string) => number,
): ProfileIdentity {
  const ordered = Object.values(snapshots)
    .filter((snapshot) => snapshot.status === "ok" && (snapshot.authenticatedAs || snapshot.plan))
    .toSorted((left, right) => rank(left.providerId) - rank(right.providerId));
  const snapshot = ordered[0];
  if (!snapshot) return { name: null, plan: null };
  const name = snapshot.authenticatedAs?.split("@")[0]?.trim();
  return { name: name || null, plan: snapshot.plan?.trim() || null };
}

/** Uppercase first character of the shown name, for the avatar circle. */
export function profileInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}
