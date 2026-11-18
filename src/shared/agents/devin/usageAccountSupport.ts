/**
 * ViscosityCode: Devin's declaration for the shared usage-account resolver
 * (src/shared/usageAccountId.ts). Configuration profiles share their login
 * owner's single meter, so account pools and the host see one account.
 */
import type { ProfileUsageAccountSupport } from "../../usageAccountId";
import { devinUsageAccountId } from "./usageAccount";

export const devinUsageAccountSupport: ProfileUsageAccountSupport = {
  driver: "devin",
  usageAccountId: devinUsageAccountId,
};
