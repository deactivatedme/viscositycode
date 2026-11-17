import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { resetFeedbackDraft } from "@/renderer/state/feedbackDraftStore";
import { FEEDBACK_SERVICE_URL } from "./feedbackService";
import { FeedbackDialog } from "./FeedbackDialog";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    appVersion: "2.0.0",
    platform: "darwin",
    openExternal: vi.fn<() => Promise<void>>(),
  }),
}));
vi.mock("@vercel/blob/client", () => ({ put: vi.fn<() => Promise<void>>() }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetFeedbackDraft();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("ships without a feedback service", () => {
  expect(FEEDBACK_SERVICE_URL).toBeNull();
});

it("never contacts a feedback service and cannot send without one", () => {
  render(<FeedbackDialog isOpen onOpenChange={vi.fn<(open: boolean) => void>()} />);

  expect(screen.getByRole("status")).toHaveTextContent(
    "Feedback is temporarily unavailable. Please try again later.",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Changes stay stale" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "What happened?" }), {
    target: { value: "Previous branch files remain after switching branches." },
  });
  const send = screen.getByRole("button", { name: "Send" });
  expect(send).toBeDisabled();
  fireEvent.submit(send.closest("form")!);

  expect(fetchMock).not.toHaveBeenCalled();
  // No issue tracker until the fork has a repository: no link to Poracode's.
  expect(screen.queryByRole("button", { name: "Existing issues" })).not.toBeInTheDocument();
});
