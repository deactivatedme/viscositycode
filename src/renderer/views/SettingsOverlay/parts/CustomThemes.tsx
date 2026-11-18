// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CUSTOM_THEME_VERSION,
  MAX_THEME_JSON_LENGTH,
  parseThemeDocument,
  type CustomTheme,
  type ThemeDocument,
} from "@/shared/customThemes";
import { THEME_SPECS, getThemePreset } from "@/renderer/theme/themePresets";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { Button, ConfirmDialog } from "@/renderer/components/common";
// ViscosityCode: share any theme, import from a link, de-duplicate imports.
import { ThemeShareMenu } from "@/renderer/theme/viscosity/ThemeShareMenu";
import { ThemeUrlImportDialog } from "@/renderer/theme/viscosity/ThemeUrlImportDialog";
import { planThemeImport } from "@/renderer/theme/viscosity/themeImportPlan";
import { readThemeFetchBridge } from "@/renderer/theme/viscosity/themeUrlImport";
import { CustomThemeEditor } from "./CustomThemeEditor";

export function CustomThemes() {
  const { t } = useLingui();
  const themePreset = useSharedSettings((state) => state.themePreset);
  const customThemes = useSharedSettings((state) => state.customThemes);
  const removeCustomTheme = useSharedSettings((state) => state.removeCustomTheme);
  const setThemePreset = useSharedSettings((state) => state.setThemePreset); // ViscosityCode:
  const activeCustom = customThemes.find((theme) => theme.id === themePreset);
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [deleting, setDeleting] = useState<CustomTheme | null>(null);
  const [importError, setImportError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  // ViscosityCode: link import dialog (desktop bridge only) and dedupe notice.
  const canImportFromUrl = readThemeFetchBridge() !== null;
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [alreadyInstalled, setAlreadyInstalled] = useState<CustomTheme | null>(null);
  // ViscosityCode: the notice describes one import; choosing another theme ends it for good.
  if (alreadyInstalled && alreadyInstalled.id !== themePreset) setAlreadyInstalled(null);
  const installedNotice = alreadyInstalled?.id === themePreset ? alreadyInstalled.label : null;

  // ViscosityCode: the same colors already installed → apply that theme;
  // otherwise review a uniquely named copy with a fresh id in the editor.
  const openImported = (doc: ThemeDocument) => {
    // Read at completion: an async import can outlive the render that started it.
    const plan = planThemeImport(doc, { customThemes: useSharedSettings.getState().customThemes });
    if (plan.kind === "existing") {
      setThemePreset(plan.theme.id);
      setAlreadyInstalled(plan.theme);
    } else setEditing(plan.theme);
  };

  const importFile = async (file: File) => {
    const generation = ++importGeneration.current;
    setAlreadyInstalled(null); // ViscosityCode:
    try {
      const doc = file.size <= MAX_THEME_JSON_LENGTH ? parseThemeDocument(await file.text()) : null;
      if (generation !== importGeneration.current) return;
      setImportError(!doc);
      if (doc) openImported(doc); // ViscosityCode: named + de-duplicated.
    } catch {
      if (generation === importGeneration.current) setImportError(true);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            importGeneration.current++;
            setImportError(false);
            setAlreadyInstalled(null); // ViscosityCode:
            const source =
              activeCustom ??
              THEME_SPECS.find((spec) => spec.id === getThemePreset(themePreset).id) ??
              THEME_SPECS[0]!;
            setEditing({
              ...source,
              version: CUSTOM_THEME_VERSION,
              id: `custom:${crypto.randomUUID()}`,
              label: t`My theme`,
            });
          }}
        >
          <Trans>Create custom theme</Trans>
        </Button>
        <Button size="sm" variant="secondary" onPress={() => fileInput.current?.click()}>
          <Trans>Import theme</Trans>
        </Button>
        {/* ViscosityCode: download a theme from an https link (desktop app). */}
        {canImportFromUrl ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              importGeneration.current++;
              setImportError(false);
              setAlreadyInstalled(null);
              setUrlImportOpen(true);
            }}
          >
            <Trans>Import from URL…</Trans>
          </Button>
        ) : null}
        {/* ViscosityCode: share the active theme (bundled or custom) as v1 JSON. */}
        <ThemeShareMenu themeId={themePreset} customThemes={customThemes} />
        {activeCustom ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                importGeneration.current++;
                setImportError(false);
                setEditing(activeCustom);
              }}
            >
              <Trans>Edit theme</Trans>
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setDeleting(activeCustom)}>
              <Trans>Delete theme</Trans>
            </Button>
          </>
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label={t`Import theme`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {importError ? (
        <p role="alert" className="text-xs text-danger">
          <Trans>
            Could not import this theme. Use a version 1 theme JSON file under 32 KB with a name and
            valid light and dark palettes.
          </Trans>
        </p>
      ) : null}
      {/* ViscosityCode: an import whose colors are already installed. */}
      <p role="status" className="text-xs text-muted empty:hidden">
        {installedNotice ? (
          <Trans>
            This theme is already installed as “{installedNotice}”, so that theme was applied
            instead of adding a copy.
          </Trans>
        ) : null}
      </p>
      {urlImportOpen ? (
        <ThemeUrlImportDialog
          onClose={() => setUrlImportOpen(false)}
          onImported={(doc) => {
            setUrlImportOpen(false);
            openImported(doc);
          }}
        />
      ) : null}
      {editing ? (
        <CustomThemeEditor
          key={editing.id}
          initial={editing}
          onClose={() => {
            importGeneration.current++;
            setEditing(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        isOpen={deleting !== null}
        title={t`Delete theme`}
        body={t`Delete this custom theme? If it is active, Poracode will use the default theme.`}
        confirmLabel={t`Delete`}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) removeCustomTheme(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
