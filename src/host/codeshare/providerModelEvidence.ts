import { ProviderFailure } from "./providerTransport";

/** Compare only the exact ID or its provider-reported dated snapshot. */
export function confirmServedModel(
  requested: string,
  reported: string,
  snapshotDate: RegExp,
): void {
  if (requested === reported) return;
  if (reported.replace(snapshotDate, "") === requested && !snapshotDate.test(requested)) return;
  throw new ProviderFailure("model_mismatch");
}
