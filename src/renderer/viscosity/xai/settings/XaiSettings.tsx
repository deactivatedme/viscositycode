/**
 * ViscosityCode: Settings → xAI API (fork of Poracode).
 *
 * The xAI API key Grok seats in a Roundtable use (masked input, Save, Remove,
 * and its status: from the XAI_API_KEY environment variable or stored on this
 * device, with the last four characters). A key saved on this device can be
 * removed even while XAI_API_KEY wins over it; the status says which one is
 * in use.
 *
 * The key goes straight to the desktop main process, which encrypts it with
 * the OS (Electron safeStorage); this page never holds it after Save and
 * only ever reads its status. Other clients have no xAI bridge and say so.
 */
import { useState } from "react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { KeyRound, Trash2 } from "lucide-react";
import type { XaiKeyStatus } from "@/shared/viscosity/xaiContract";
import { Button, Input } from "@/renderer/components/common";
import { SettingRow, SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { removeXaiKey, saveXaiKey, useXaiKeyStatus } from "../useXaiKeyStatus";

/** Whether a key is saved on this device, so Remove has something to delete. */
function hasStoredXaiKey(status: XaiKeyStatus | undefined): boolean {
  return status?.source === "stored" || status?.hasStoredKey === true;
}

function useKeyStatusText(status: XaiKeyStatus | undefined): string {
  const { t } = useLingui();
  if (!status) return t`Checking…`;
  // Main sends no hint for very short keys; never render an empty "()".
  const hint = status.hint ? `…${status.hint}` : undefined;
  switch (status.source) {
    case "env":
      if (status.hasStoredKey === true) {
        return hint
          ? t`Using XAI_API_KEY from the environment (${hint}). It takes precedence over the key saved on this device, which you can remove.`
          : t`Using XAI_API_KEY from the environment. It takes precedence over the key saved on this device, which you can remove.`;
      }
      return hint
        ? t`Using XAI_API_KEY from the environment (${hint}). It takes precedence over a saved key.`
        : t`Using XAI_API_KEY from the environment. It takes precedence over a saved key.`;
    case "stored":
      return hint
        ? t`Saved on this device, encrypted by your operating system (${hint}).`
        : t`Saved on this device, encrypted by your operating system.`;
    case "none":
      return status.hasStoredKey === true
        ? t`A saved key can't be read on this device. Remove it or save a new one.`
        : t`No key yet. Grok stays unavailable in Roundtables until you add one.`;
  }
}

function XaiKeyRow() {
  const { t } = useLingui();
  const { available, status: keyStatus, loading, error } = useXaiKeyStatus();
  const status: XaiKeyStatus | undefined = keyStatus;
  const [draft, setDraft] = useState("");
  const statusText = useKeyStatusText(status);
  const canSave = available && !loading && draft.trim().length > 0;
  const canRemove = available && !loading && hasStoredXaiKey(status);

  async function save() {
    if (!canSave) return;
    try {
      await saveXaiKey(draft.trim());
      // The key is in the main process now; never keep it in page state.
      setDraft("");
      toast.success(t`xAI API key saved.`);
    } catch (failure) {
      toast.danger(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function remove() {
    if (!canRemove) return;
    try {
      const next = await removeXaiKey();
      toast.success(
        next.source === "env"
          ? t`Saved xAI API key removed from this device. XAI_API_KEY from the environment still applies.`
          : t`xAI API key removed from this device.`,
      );
    } catch (failure) {
      toast.danger(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <div className="space-y-2">
      <SettingRow
        anchorId="xai.apiKey"
        title={t`xAI API key`}
        description={t`Used by Grok seats in a Roundtable. Kept in the desktop app's main process, never in pages.`}
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            type="password"
            aria-label={t`xAI API key`}
            className="w-56 font-mono text-xs"
            placeholder={status?.hint ? `••••${status.hint}` : t`Paste your xAI API key`}
            value={draft}
            disabled={!available || loading}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void save();
            }}
          />
          <Button size="sm" variant="secondary" isDisabled={!canSave} onPress={() => void save()}>
            <KeyRound className="size-3.5" />
            {t({ message: "Save", comment: "Button: save the xAI API key" })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted"
            isDisabled={!canRemove}
            onPress={() => void remove()}
          >
            <Trash2 className="size-3.5" />
            {t({ message: "Remove", comment: "Button: remove the saved xAI API key" })}
          </Button>
        </div>
      </SettingRow>
      <p role="status" className="text-xs text-muted" data-vc-xai-key-status={status?.source ?? ""}>
        {available
          ? (error ?? statusText)
          : t`Grok over the xAI API works only in the desktop app.`}
      </p>
    </div>
  );
}

export function XaiSettings() {
  const { t } = useLingui();
  return (
    <SettingsPage
      title={t({
        message: "xAI API",
        comment: "Settings section: the xAI API key that Grok in a Roundtable uses",
      })}
      description={t`Grok models over the xAI API, billed to your xAI account. A Roundtable can seat them next to your agents.`}
      bodyClassName="space-y-6"
    >
      <XaiKeyRow />
    </SettingsPage>
  );
}
