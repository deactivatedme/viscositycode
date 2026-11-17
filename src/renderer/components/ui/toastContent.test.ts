// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "@/shared/brand";
import { normalizeToastContent } from "./toastContent";

describe("normalizeToastContent", () => {
  it("keeps short danger titles unchanged", () => {
    expect(normalizeToastContent("danger", "Unable to open file", undefined)).toEqual({
      title: "Unable to open file",
      description: undefined,
    });
  });

  it("splits long prefixed danger messages into title and scrollable description", () => {
    const detail = "Corepack is about to download pnpm. ".repeat(12);

    expect(normalizeToastContent("danger", `Update error: ${detail}`, undefined)).toEqual({
      title: "Update error",
      description: detail.trimEnd(),
    });
  });

  it("uses the first line as a bounded title for multiline danger messages", () => {
    const message = [
      "Pre-commit hook failed",
      "husky - ~/.huskyrc is DEPRECATED",
      "node:internal/modules/esm/utils:231",
      "TypeError [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING]",
      "Node.js v20.12.2",
    ].join("\n");

    expect(normalizeToastContent("danger", message, undefined)).toEqual({
      title: "Pre-commit hook failed",
      description: message,
    });
  });

  it("keeps existing descriptions while moving long danger titles into details", () => {
    const message = "Update error: " + "detail ".repeat(40);

    expect(normalizeToastContent("danger", message, "Existing details")).toEqual({
      title: "Update error",
      description: `Existing details\n\n${"detail ".repeat(40).trimEnd()}`,
    });
  });

  // ViscosityCode: toasts show raw engine text; it names the fork, paths stay verbatim.
  it("brands upstream product names in toast text without touching paths", () => {
    expect(
      normalizeToastContent(
        "danger",
        "Poracode could not open /Users/me/Poracode/notes.md",
        "Restart Poracode and try again.",
      ),
    ).toEqual({
      title: `${BRAND_NAME} could not open /Users/me/Poracode/notes.md`,
      description: `Restart ${BRAND_NAME} and try again.`,
    });
    expect(normalizeToastContent("default", "Poracode updated", undefined)).toEqual({
      title: `${BRAND_NAME} updated`,
      description: undefined,
    });
    const node: ReactNode = ["Poracode"];
    expect(normalizeToastContent("success", node, node)).toEqual({
      title: node,
      description: node,
    });

    const long = `Update error: Poracode ${"detail ".repeat(40)}`;
    expect(normalizeToastContent("danger", long, undefined)).toEqual({
      title: "Update error",
      description: `${BRAND_NAME} ${"detail ".repeat(40).trimEnd()}`,
    });
  });

  it("does not duplicate long title text when existing description already contains it", () => {
    const detail = "detail ".repeat(40);
    const message = `Update error: ${detail}`;

    expect(normalizeToastContent("danger", message, detail)).toEqual({
      title: "Update error",
      description: detail,
    });
  });
});
// @vitest-environment node
