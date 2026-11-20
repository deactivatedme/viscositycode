/**
 * ViscosityCode: where a Cursor profile runs (fork of Poracode).
 *
 * A Cursor profile runs its agents on this computer (the default, and every
 * profile saved before this setting) or in Cursor Cloud, against the
 * project's pushed branch, with the profile's own API key. The choice is the
 * profile's `config` (`src/shared/agents/cursor/profileConfig.ts`); the host
 * validates it again on save. A config from a newer format is shown as
 * read-only and left untouched.
 */
import { useState } from "react";
import { toast } from "@heroui/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CURSOR_PROFILE_CONFIG_FORMAT,
  parseCursorProfileConfig,
  type CursorProfileRuntimeTarget,
} from "@/shared/agents/cursor/profileConfig";
import { cursorProfileKind, type AgentInstanceConfig } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { Select, ToggleSwitch } from "@/renderer/components/common";
import { flushSharedSettings, useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { currentWslDistros } from "@/renderer/utils/acpRegistryAuth";

/** Shared with the Cloud tab's setup hint, so the hint names the real labels. */
export const CURSOR_PROFILES_HEADING = msg`Profiles`;
export const CURSOR_RUN_IN_LABEL = msg`Run in`;
export const CURSOR_LOCAL_TARGET_LABEL = msg`This computer`;
export const CURSOR_CLOUD_TARGET_LABEL = msg`Cursor Cloud`;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The profile's config with this choice applied; keys this build does not know survive. */
export function cursorProfileConfigPatch(
  stored: unknown,
  patch: { runtimeTarget: CursorProfileRuntimeTarget; autoCreatePR: boolean },
): Record<string, unknown> {
  const { autoCreatePR: _previous, ...rest } = asRecord(stored);
  return {
    ...rest,
    format: CURSOR_PROFILE_CONFIG_FORMAT,
    runtimeTarget: patch.runtimeTarget,
    // Pull requests are a cloud-only choice.
    ...(patch.runtimeTarget === "cloud" && patch.autoCreatePR ? { autoCreatePR: true } : {}),
  };
}

/** The "Run in" choice on one Cursor profile's settings page. */
export function CursorCloudProfileSettings(props: { profileInstanceId: string }) {
  const instance = useSharedSettings((state) => state.agentInstances[props.profileInstanceId]);
  if (!instance) return null;
  return <CursorRunInSettings instance={instance} />;
}

function CursorRunInSettings(props: { instance: AgentInstanceConfig }) {
  const { instance } = props;
  const { t } = useLingui();
  const setAgentInstance = useSharedSettings((state) => state.setAgentInstance);
  const [saving, setSaving] = useState(false);
  const parsed = parseCursorProfileConfig(instance.config);

  if (parsed.status !== "ok") {
    return (
      <p className="text-xs text-warning" data-cursor-profile-config="unsupported">
        <Trans>
          This profile was saved by a newer or different version of ViscosityCode. Its run location
          is kept as stored and cannot be changed here.
        </Trans>
      </p>
    );
  }
  const runtimeTarget = parsed.runtimeTarget;
  const autoCreatePR = parsed.config.autoCreatePR === true;

  const save = (next: { runtimeTarget: CursorProfileRuntimeTarget; autoCreatePR: boolean }) => {
    if (saving) return;
    const previous = instance;
    setSaving(true);
    const persist = async () => {
      setAgentInstance({ ...instance, config: cursorProfileConfigPatch(instance.config, next) });
      try {
        // The host validates the config; a refused write must not look saved.
        await flushSharedSettings({ requireSuccess: true });
      } catch (error) {
        setAgentInstance(previous);
        await flushSharedSettings().catch(() => undefined);
        toast.danger(friendlyError(error));
        return;
      }
      // Capabilities and the cloud source follow the run location. The save stands if this fails.
      await readBridge()
        .refreshAgentStatuses(currentWslDistros(), {
          agentKinds: [cursorProfileKind(instance.id)],
        })
        .catch((error: unknown) => toast.danger(friendlyError(error)));
    };
    void persist().finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-col gap-2" data-cursor-profile-run-in="">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted">{t(CURSOR_RUN_IN_LABEL)}</span>
        <div className="max-w-sm">
          <Select
            aria-label={t(CURSOR_RUN_IN_LABEL)}
            isDisabled={saving}
            options={[
              { id: "local", label: t(CURSOR_LOCAL_TARGET_LABEL) },
              { id: "cloud", label: t(CURSOR_CLOUD_TARGET_LABEL) },
            ]}
            value={runtimeTarget}
            onChange={(value) => {
              if (value !== "local" && value !== "cloud") return;
              if (value === runtimeTarget) return;
              save({ runtimeTarget: value, autoCreatePR });
            }}
          />
        </div>
      </div>
      {runtimeTarget === "cloud" ? (
        <>
          <ToggleSwitch
            isSelected={autoCreatePR}
            isDisabled={saving}
            onChange={(selected) => save({ runtimeTarget, autoCreatePR: selected })}
          >
            <span className="text-xs text-foreground">
              <Trans>Create pull requests automatically</Trans>
            </span>
          </ToggleSwitch>
          <p className="text-[11px] text-muted">
            <Trans>
              Cloud agents start from the project's pushed branch. Push your branch before you start
              one.
            </Trans>
          </p>
        </>
      ) : null}
      <p className="text-[11px] text-muted">
        <Trans>
          Use a User API key from cursor.com/dashboard/api. Cloud runs bill to that Cursor account.
        </Trans>
      </p>
    </div>
  );
}
