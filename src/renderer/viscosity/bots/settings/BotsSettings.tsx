/**
 * ViscosityCode: Settings → Bots (fork of Poracode).
 *
 * The xAI API key for Grok bots (masked input, Save, Remove, and its status:
 * from the XAI_API_KEY environment variable or stored on this device, with
 * the last four characters), the defaults new Grok bots start with, and a
 * short note that bots on agent brains use the user's existing subscriptions.
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
import { Button, Input, Select } from "@/renderer/components/common";
import { SettingRow, SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import {
  removeXaiKey,
  saveXaiKey,
  useXaiKeyStatus,
} from "@/renderer/viscosity/xai/useXaiKeyStatus";
import { useBotsStore } from "../botStore";
import { ToolCheckbox } from "../ui/ToolCheckbox";

function useKeyStatusText(status: XaiKeyStatus | undefined): string {
  const { t } = useLingui();
  if (!status) return t`Checking…`;
  // Main sends no hint for very short keys; never render an empty "()".
  const hint = status.hint ? `…${status.hint}` : undefined;
  switch (status.source) {
    case "env":
      return hint
        ? t`Using XAI_API_KEY from the environment (${hint}). It takes precedence over a saved key.`
        : t`Using XAI_API_KEY from the environment. It takes precedence over a saved key.`;
    case "stored":
      return hint
        ? t`Saved on this device, encrypted by your operating system (${hint}).`
        : t`Saved on this device, encrypted by your operating system.`;
    case "none":
      return t`No key yet. Grok bots stay unavailable until you add one.`;
  }
}

function XaiKeyRow() {
  const { t } = useLingui();
  const { available, status, loading, error } = useXaiKeyStatus();
  const [draft, setDraft] = useState("");
  const statusText = useKeyStatusText(status);
  const canSave = available && !loading && draft.trim().length > 0;
  const canRemove = available && !loading && status?.source === "stored";

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
      await removeXaiKey();
      toast.success(t`xAI API key removed from this device.`);
    } catch (failure) {
      toast.danger(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <div className="space-y-2">
      <SettingRow
        anchorId="bots.xaiKey"
        title={t`xAI API key`}
        description={t`Used only by Grok bots. Kept in the desktop app's main process, never in pages.`}
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
        {available ? (error ?? statusText) : t`Grok bots work only in the desktop app.`}
      </p>
    </div>
  );
}

export function BotsSettings() {
  const { t } = useLingui();
  const xaiDefaults = useBotsStore((state) => state.xaiDefaults);
  const setXaiDefaults = useBotsStore((state) => state.setXaiDefaults);
  const regionOptions = [
    { id: "global", label: t`Global (api.x.ai)` },
    { id: "us", label: t`United States only (us.api.x.ai)` },
  ];

  return (
    <SettingsPage
      title={t({ message: "Bots", comment: "Settings section: named AI teammates (bots)" })}
      description={t`Named AI teammates with their own brain, instructions and memory.`}
      bodyClassName="space-y-6"
    >
      <p role="note" className="rounded-lg border border-border px-3 py-2 text-xs text-muted">
        {t`Bots on an agent brain run through the agents you already use, on your existing subscriptions and logins, with each agent's own approval settings. Nothing here is needed for them.`}
      </p>

      <section className="space-y-4" aria-label={t`Grok on the xAI API`}>
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">{t`Grok on the xAI API`}</h2>
          <p className="mt-1 text-xs text-muted">
            {t`Bots can also think with a Grok model over the xAI API, billed to your xAI account.`}
          </p>
        </div>

        <XaiKeyRow />

        <SettingRow
          anchorId="bots.defaultRegion"
          title={t`Default region`}
          description={t`Where new Grok bots send requests. The US endpoint serves text models only.`}
        >
          <Select
            aria-label={t`Default region`}
            className="w-56 shrink-0"
            options={regionOptions}
            value={xaiDefaults.region}
            onChange={(value) => setXaiDefaults({ region: value === "us" ? "us" : "global" })}
          />
        </SettingRow>

        <SettingRow
          anchorId="bots.defaultTools"
          title={t`Default tools`}
          description={t`Server-side search tools new Grok bots start with.`}
        >
          <div className="flex shrink-0 items-center gap-4">
            <ToolCheckbox
              isSelected={xaiDefaults.tools.webSearch}
              onChange={(webSearch) =>
                setXaiDefaults({ tools: { ...xaiDefaults.tools, webSearch } })
              }
            >
              {t`Web search`}
            </ToolCheckbox>
            <ToolCheckbox
              isSelected={xaiDefaults.tools.xSearch}
              onChange={(xSearch) => setXaiDefaults({ tools: { ...xaiDefaults.tools, xSearch } })}
            >
              {t`X search`}
            </ToolCheckbox>
          </div>
        </SettingRow>
      </section>
    </SettingsPage>
  );
}
