import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "@/shared/brand";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ErrorItem } from "./ErrorItem";

function errorItem(payload: unknown): RuntimeChatItem {
  return { id: "error-1", type: "error", state: "completed", payload, streams: {} };
}

// ViscosityCode: transcript error items show engine text with the fork's name.
describe("ErrorItem", () => {
  it("brands the upstream product name for display and keeps paths verbatim", () => {
    const payload = {
      message: "Agent launch refused, so Poracode will not start provider sessions in ~/Poracode.",
    };
    render(<ErrorItem item={errorItem(payload)} />);

    expect(
      screen.getByText(
        `Agent launch refused, so ${BRAND_NAME} will not start provider sessions in ~/Poracode.`,
      ),
    ).toBeInTheDocument();
    expect(payload.message).toContain("so Poracode will not");
  });

  it("falls back to a generic label without a message", () => {
    render(<ErrorItem item={errorItem(undefined)} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});
