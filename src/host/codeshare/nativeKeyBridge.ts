import { randomUUID } from "node:crypto";
import type { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { parseModel } from "@/shared/codeShare";
export type NativeKeyBridge = Pick<SupervisorClient, "callCodeShare">;
export async function nativeKeyCatalog(
  supervisor: NativeKeyBridge | undefined,
  provider: string,
  key: string,
) {
  if (!supervisor) throw new Error("The native account-key runtime is unavailable.");
  const catalog = await supervisor.callCodeShare<
    { id: string; label: string; remoteEditing?: true }[]
  >({ action: "key-catalog", id: randomUUID(), provider, key });
  return catalog.map(({ id, label, remoteEditing }) => ({
    ...parseModel(`${provider}:${id}`),
    label,
    ...(remoteEditing ? { remoteEditing } : {}),
  }));
}
