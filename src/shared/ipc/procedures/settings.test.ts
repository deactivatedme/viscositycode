import { describe, expect, it } from "vitest";
import { ipcProcedureMap } from "../procedureMap";
import { windowChromePayloadSchema } from "../schemas";
import { windowChromeProcedurePayloadSchema, WINDOW_MATERIAL_PREFERENCES } from "./settings";

// ViscosityCode: `setWindowChrome` gained an optional `windowMaterial` field.
describe("setWindowChrome payload", () => {
  const upstreamPayload = {
    backgroundColor: "rgba(0, 0, 0, 0)",
    symbolColor: "#fafafa",
    materialEnabled: true,
    appearance: "dark",
  } as const;

  it("is the procedure's payload schema on the unchanged main-local transport", () => {
    expect(ipcProcedureMap.setWindowChrome.transport).toBe("main-local");
    expect(ipcProcedureMap.setWindowChrome.payloadSchema).toBe(windowChromeProcedurePayloadSchema);
  });

  it("still parses payloads written before the field existed, without inventing one", () => {
    // Pre-upgrade shapes: the current upstream payload and the oldest one
    // (before `materialEnabled` / `appearance` were added).
    expect(ipcProcedureMap.setWindowChrome.payloadSchema.parse(upstreamPayload)).toEqual(
      upstreamPayload,
    );
    const oldest = { backgroundColor: "#000000", symbolColor: "#1f2937" };
    const parsed = ipcProcedureMap.setWindowChrome.payloadSchema.parse(oldest);
    expect(parsed).toEqual(oldest);
    expect("windowMaterial" in parsed).toBe(false);
  });

  it("accepts every preference and rejects values it does not know", () => {
    for (const windowMaterial of WINDOW_MATERIAL_PREFERENCES) {
      expect(
        windowChromeProcedurePayloadSchema.parse({ ...upstreamPayload, windowMaterial }),
      ).toEqual({ ...upstreamPayload, windowMaterial });
    }
    expect(
      windowChromeProcedurePayloadSchema.safeParse({ ...upstreamPayload, windowMaterial: "tabbed" })
        .success,
    ).toBe(false);
  });

  it("is stripped, not rejected, by the upstream schema an older main process uses", () => {
    expect(windowChromePayloadSchema.parse({ ...upstreamPayload, windowMaterial: "mica" })).toEqual(
      upstreamPayload,
    );
  });
});
