import { startTransition } from "react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { isRemoteSession, isWindows } from "@/renderer/bridge";
import { hasElectronHostBridge, isBrowserClientRuntime } from "@/renderer/clientRuntime";
import { Select } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import {
  isWindowMaterialPreference,
  setWindowMaterialPreference,
  useWindowMaterialPreference,
} from "./windowMaterialStore";

const windowMaterialOptions = [
  { id: "auto", label: msg`Auto` },
  { id: "mica", label: msg`Mica` },
  { id: "acrylic", label: msg`Acrylic` },
  { id: "none", label: msg`None` },
] as const;

/**
 * The backdrop is a Windows 11 DWM material applied by this desktop's own main
 * process, so the row exists only in the Electron app on Windows: not on macOS
 * (vibrancy), Linux, the browser/PWA client or a renderer paired to a remote host.
 */
export function shouldShowWindowMaterialSetting(env: {
  hasDesktopBridge: boolean;
  browserRuntime: boolean;
  remoteSession: boolean;
  windows: boolean;
}): boolean {
  return env.hasDesktopBridge && !env.browserRuntime && !env.remoteSession && env.windows;
}

function readWindowMaterialSettingVisibility(): boolean {
  // Checked first: the bridge readers below assume a client bridge exists.
  if (!hasElectronHostBridge()) return false;
  return shouldShowWindowMaterialSetting({
    hasDesktopBridge: true,
    browserRuntime: isBrowserClientRuntime(),
    remoteSession: isRemoteSession(),
    windows: isWindows(),
  });
}

/** ViscosityCode: Settings → Appearance row for the Windows window backdrop. */
export function WindowMaterialSetting() {
  const { t } = useLingui();
  const preference = useWindowMaterialPreference();
  const sidebarTranslucency = useSharedSettings((state) => state.sidebarTranslucency);
  if (!readWindowMaterialSettingVisibility()) return null;

  const options = windowMaterialOptions.map((option) => ({
    id: option.id,
    label: t(option.label),
  }));

  return (
    <SettingRow
      title={t`Window material`}
      description={
        sidebarTranslucency
          ? t`The Windows 11 backdrop behind the translucent sidebar. Auto uses Mica; None keeps the in-app tint.`
          : t`Turn on Translucent sidebar to use a Windows 11 backdrop.`
      }
    >
      <Select
        aria-label={t`Window material`}
        className="w-[160px] shrink-0"
        options={options}
        value={preference}
        isDisabled={!sidebarTranslucency}
        onChange={(value) => {
          if (!isWindowMaterialPreference(value)) return;
          startTransition(() => {
            setWindowMaterialPreference(value);
          });
        }}
      />
    </SettingRow>
  );
}
