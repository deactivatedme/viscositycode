/**
 * ViscosityCode: "Share theme" menu for the active theme (bundled or custom):
 * copy its version 1 JSON to the clipboard, or save it as a file.
 */
import { Dropdown, Label, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, Copy, Download, Share2 } from "lucide-react";
import type { CustomTheme } from "@/shared/customThemes";
import { Button } from "@/renderer/components/common";
import { downloadTextFile } from "@/renderer/utils/downloadTextFile";
import { copyThemeJson, shareableThemeFile } from "./themeShare";

export function ThemeShareMenu(props: { themeId: string; customThemes: readonly CustomTheme[] }) {
  const { t } = useLingui();
  const file = shareableThemeFile(props.themeId, props.customThemes);

  const copy = async (json: string, label: string) => {
    if (await copyThemeJson(json)) toast.success(t`Copied the ${label} theme JSON`);
    else toast.danger(t`Could not copy to the clipboard.`);
  };

  return (
    <Dropdown>
      <Button size="sm" variant="ghost" isDisabled={!file}>
        <Share2 aria-hidden="true" className="size-3.5" />
        <Trans>Share theme</Trans>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu
          aria-label={t`Share theme`}
          className="poracode-menu min-w-44"
          onAction={(key) => {
            if (!file) return;
            if (key === "copy") void copy(file.json, file.label);
            else if (key === "save") downloadTextFile(file.filename, file.json, "application/json");
          }}
        >
          <Dropdown.Item id="copy" textValue={t`Copy JSON`}>
            <Copy aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
            <Label>
              <Trans>Copy JSON</Trans>
            </Label>
          </Dropdown.Item>
          <Dropdown.Item id="save" textValue={t`Save as file`}>
            <Download aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
            <Label>
              <Trans>Save as file</Trans>
            </Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
