import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Modal } from "@heroui/react";
import { expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ShareRoomSnapshot } from "@/shared/codeShareRoom";
import type { CodeShareConnection } from "./client";
import { CodeShareRoomPanel } from "./CodeShareRoomPanel";

const worker = vi.hoisted(() => ({
  run: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  resume: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/threadActions", () => ({ openThread: vi.fn<() => void>() }));

vi.mock("./roomWorker", () => ({
  readCodeShareRoomThreadId: () => undefined,
  resumeCodeShareRoomTurn: worker.resume,
  runCodeShareRoomTurn: worker.run,
}));

vi.mock("./subscription", () => ({
  readCodeShareLocalProject: () => ({ id: "project", name: "Workspace" }),
  openCodeShareSubscriptionSignIn: vi.fn<() => void>(),
}));

it("shows the author and computer, and runs a teammate's request only after approval", async () => {
  const room = { id: "5b2e6a91-6014-412c-9ad6-4c8d9dedc005", label: "Pair coding" };
  const me = "51ff43a2-abaa-4e6b-af8e-9af0598587fc";
  const other = "16b70c44-757c-4fcf-8488-ee48be672a1b";
  const model = {
    id: "claude:claude-fable-5-2",
    label: "Fable 5.2",
    model: "claude-fable-5-2",
    provider: "claude",
    execution: "guest-subscription" as const,
  };
  const turn = {
    id: "8cb62ce5-3fb3-4efb-a0fd-8443143671cf",
    authorId: other,
    authorName: "Avery",
    runner: me,
    runnerName: "Bea",
    model: model.id,
    prompt: "Review the README",
    reply: "",
    status: "queued" as const,
  };
  const snapshot: ShareRoomSnapshot = {
    protocolVersion: 2,
    revision: 1,
    active: true,
    memberId: me,
    members: [
      { id: other, label: "Avery", ready: true, models: [model.id] },
      { id: me, label: "Bea", ready: true, models: [model.id] },
    ],
    turns: [turn],
  };
  const send = vi
    .fn<(request: { runner: string; prompt: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const client = {
    roomSnapshot: vi.fn<() => Promise<ShareRoomSnapshot>>().mockResolvedValue(snapshot),
    setRoomReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    sendRoomTurn: send,
  } as unknown as CodeShareConnection;
  render(
    <Modal.Backdrop isOpen>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{room.label}</Modal.Heading>
          </Modal.Header>
          <CodeShareRoomPanel
            connection={client}
            room={room}
            models={[model]}
            inactive={false}
            outOfTurns={false}
            leave={vi.fn<() => void>()}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>,
  );
  expect(await screen.findByText(turn.prompt)).toBeInTheDocument();
  expect(screen.getByText("Avery", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByText("Bea", { selector: "span" })).toBeInTheDocument();
  expect(worker.run).not.toHaveBeenCalled();

  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Check the tests" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        model: model.id,
        prompt: "Check the tests",
        runner: other,
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run here" }));
  await waitFor(() => expect(worker.run).toHaveBeenCalledWith(client, room, turn, "project"));
});
