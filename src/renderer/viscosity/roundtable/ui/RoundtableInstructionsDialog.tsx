/**
 * ViscosityCode Roundtable UI: edit a running session's instructions — one
 * block for everyone and one per participant. Saving goes through
 * `updateRoundtableInstructions`; each participant gets the new text with its
 * next reply, so the dialog says so instead of interrupting anyone.
 */
import { useState } from "react";
import { Label, Modal, TextField, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { TextArea } from "@/renderer/components/common/TextArea";
import { type RoundtableInstructionsUpdate, updateRoundtableInstructions } from "../api";
import type { RoundtableSession } from "../types";
import { ParticipantAvatar } from "./ParticipantAvatar";

/** Only what changed (trimmed), or null when nothing did. */
export function instructionsUpdate(
  session: Pick<RoundtableSession, "instructions" | "participants">,
  shared: string,
  own: Readonly<Record<string, string>>,
): RoundtableInstructionsUpdate | null {
  const update: RoundtableInstructionsUpdate = {};
  if (shared.trim() !== (session.instructions ?? "").trim()) update.shared = shared;
  const participants: Record<string, string> = {};
  for (const participant of session.participants) {
    const next = own[participant.id] ?? "";
    if (next.trim() !== (participant.instructions ?? "").trim())
      participants[participant.id] = next;
  }
  if (Object.keys(participants).length > 0) update.participants = participants;
  return Object.keys(update).length > 0 ? update : null;
}

export function RoundtableInstructionsDialog(props: {
  session: RoundtableSession;
  onClose: () => void;
}) {
  const { session, onClose } = props;
  const { t } = useLingui();
  const [shared, setShared] = useState(session.instructions ?? "");
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      session.participants.map((participant) => [participant.id, participant.instructions ?? ""]),
    ),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const update = instructionsUpdate(session, shared, own);
    if (!update) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateRoundtableInstructions(session.id, update);
      toast.success(t`Instructions updated. They apply from the next reply.`);
      onClose();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[620px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>Instructions</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4 p-4">
            <TextField value={shared} onChange={setShared}>
              <Label>
                <Trans>For everyone</Trans>
              </Label>
              <TextArea
                rows={3}
                className="min-h-20 resize-y"
                placeholder={t`Context, rules or goals every AI should follow.`}
              />
            </TextField>
            {session.participants.map((participant) => (
              <TextField
                key={participant.id}
                value={own[participant.id] ?? ""}
                onChange={(value) => setOwn((current) => ({ ...current, [participant.id]: value }))}
              >
                <Label className="flex items-center gap-2">
                  <ParticipantAvatar participant={participant} size="sm" />
                  <span className="truncate">{participant.label}</span>
                </Label>
                <TextArea
                  rows={2}
                  className="min-h-14 resize-y"
                  placeholder={t`Role or focus for this AI, e.g. backend, tests, reviewer`}
                />
              </TextField>
            ))}
          </Modal.Body>
          <Modal.Footer className="items-center">
            <p className="mr-auto min-w-0 flex-1 text-xs text-muted">
              <Trans>Changes apply from each AI's next reply.</Trans>
            </p>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="tertiary" isPending={saving} onPress={() => void save()}>
              <Trans>Save</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
