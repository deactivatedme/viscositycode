// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { startTransition, useState } from "react";
import { NumberField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ThreadRemoveAction } from "@/shared/contracts";
import type { FollowUpBehavior } from "@/shared/settings";
import { isMac, isRemoteSession } from "@/renderer/bridge";
import { useHostReturnsRemoteSetting } from "@/renderer/browser/remoteSettingsSync"; // ViscosityCode
import { isLocalDesktopWindow } from "@/renderer/viscosity/localDesktopWindow"; // ViscosityCode
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  setConfirmThreadDelete,
  shouldConfirmThreadDelete,
} from "@/renderer/state/threadDeletePreference";
import { Select, ToggleSwitch } from "@/renderer/components/common";
import { SettingRow, SettingsPage } from "./SettingsForm";
import { ResourceAdmissionSettings } from "./ResourceAdmissionSettings";
import {
  followUpBehaviorOptions,
  threadRemoveActionOptions,
  useLocalizedOptions,
} from "./settingsOptions";

export function ThreadSettings() {
  const { t } = useLingui();
  const staleThreadUnloadMinutes = useSharedSettings((state) => state.staleThreadUnloadMinutes);
  const setStaleThreadUnloadMinutes = useSharedSettings(
    (state) => state.setStaleThreadUnloadMinutes,
  );
  const autoArchiveDoneAfterDays = useSharedSettings((state) => state.autoArchiveDoneAfterDays);
  const setAutoArchiveDoneAfterDays = useSharedSettings(
    (state) => state.setAutoArchiveDoneAfterDays,
  );
  const threadRemoveAction = useSharedSettings((state) => state.threadRemoveAction);
  const setThreadRemoveAction = useSharedSettings((state) => state.setThreadRemoveAction);
  const autoMarkDoneOnPrMerge = useSharedSettings((state) => state.autoMarkDoneOnPrMerge);
  const setAutoMarkDoneOnPrMerge = useSharedSettings((state) => state.setAutoMarkDoneOnPrMerge);
  const followUpBehavior = useSharedSettings((state) => state.followUpBehavior);
  const setFollowUpBehavior = useSharedSettings((state) => state.setFollowUpBehavior);
  const [confirmThreadDelete, setConfirmThreadDeleteState] = useState(shouldConfirmThreadDelete);
  // Idle unloading and launch-time auto-archive run on the desktop; a remote
  // session's copy of these values is never read, so hide the rows there.
  const remote = isRemoteSession();
  // ViscosityCode: the host acts on these two; show them when its settings-read carries them.
  const hostAutoArchive = useHostReturnsRemoteSetting("autoArchiveDoneAfterDays");
  const hostMarkDone = useHostReturnsRemoteSetting("autoMarkDoneOnPrMerge");

  const followUpBehaviorOpts = useLocalizedOptions(followUpBehaviorOptions);
  const threadRemoveActionOpts = useLocalizedOptions(threadRemoveActionOptions);
  const followUpShortcut = isMac() ? t`Cmd+Enter` : t`Ctrl+Enter`;

  return (
    <SettingsPage title={t`Threads`}>
      <SettingRow
        anchorId="threads.followUpBehavior"
        title={t`Follow-up behavior`}
        description={
          <Trans>
            Choose whether chat messages sent while an agent is working steer the current response
            or queue for the next response. {followUpShortcut} uses the opposite action.
          </Trans>
        }
      >
        <Select
          aria-label={t`Follow-up behavior`}
          className="w-[160px] shrink-0"
          options={followUpBehaviorOpts}
          value={followUpBehavior}
          onChange={(value) => {
            startTransition(() => {
              setFollowUpBehavior(value as FollowUpBehavior);
            });
          }}
        />
      </SettingRow>

      {!remote && (
        <SettingRow
          anchorId="threads.unloadIdleThreadsAfter"
          title={t`Unload idle threads after`}
          description={
            <Trans>
              Hidden resumable threads are swept every 5 minutes and unloaded after this idle age.
            </Trans>
          }
        >
          <NumberField
            aria-label={t`Unload idle threads after (minutes)`}
            className="w-[160px] shrink-0"
            minValue={0}
            step={10}
            value={staleThreadUnloadMinutes}
            onChange={(value) => {
              if (value === undefined || Number.isNaN(value)) return;
              startTransition(() => {
                setStaleThreadUnloadMinutes(Math.max(0, Math.floor(value)));
              });
            }}
          >
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </SettingRow>
      )}

      {(!remote || hostAutoArchive) && (
        <SettingRow
          anchorId="threads.autoArchiveDoneAfter"
          title={t`Auto-archive done threads after`}
          description={
            <Trans>
              Threads marked done that have not been touched for this many days are archived
              automatically on app launch. Set to 0 to disable.
            </Trans>
          }
        >
          <NumberField
            aria-label={t`Auto-archive done threads after (days)`}
            className="w-[160px] shrink-0"
            minValue={0}
            maxValue={3650}
            step={1}
            value={autoArchiveDoneAfterDays}
            onChange={(value) => {
              if (Number.isNaN(value)) return;
              startTransition(() => {
                setAutoArchiveDoneAfterDays(Math.max(0, Math.floor(value)));
              });
            }}
          >
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </SettingRow>
      )}

      {(!remote || hostMarkDone) && (
        <SettingRow
          anchorId="threads.markDoneOnPrMerge"
          title={t`Mark done when the pull request merges`}
          description={
            <Trans>
              Worktree threads are marked done as soon as Poracode sees their pull request merge.
              Threads mid-turn wait until the turn finishes.
            </Trans>
          }
        >
          <ToggleSwitch
            aria-label={t`Mark done when the pull request merges`}
            isSelected={autoMarkDoneOnPrMerge}
            onChange={(selected) => {
              startTransition(() => {
                setAutoMarkDoneOnPrMerge(selected);
              });
            }}
          />
        </SettingRow>
      )}

      {/* ViscosityCode: these two are device-local, so remote sessions show them too. */}
      <SettingRow
        anchorId="threads.defaultThreadRemoval"
        title={t`Default thread removal`}
        description={<Trans>Action for the quick-remove button on sidebar threads.</Trans>}
      >
        <Select
          aria-label={t`Default thread removal`}
          className="w-[160px] shrink-0"
          options={threadRemoveActionOpts}
          value={threadRemoveAction}
          onChange={(value) => {
            startTransition(() => {
              setThreadRemoveAction(value as ThreadRemoveAction);
            });
          }}
        />
      </SettingRow>

      <SettingRow
        anchorId="threads.confirmThreadDelete"
        title={t`Confirm before deleting threads`}
        description={<Trans>Show a confirmation before permanently deleting a thread.</Trans>}
      >
        <ToggleSwitch
          aria-label={t`Confirm before deleting threads`}
          isSelected={confirmThreadDelete}
          onChange={(selected) => {
            setConfirmThreadDelete(selected);
            setConfirmThreadDeleteState(selected);
          }}
        />
      </SettingRow>

      {/* Host execution-slot bounds are absent from the remote settings wire, so an
          ordinary remote session cannot edit the paired host's policy; hide them
          there instead of pretending a local edit reaches the host. */}
      {!remote && <ResourceAdmissionSettings />}

      {/* ViscosityCode: say why the desktop window shows less than the Electron app. */}
      {isLocalDesktopWindow() ? (
        <p className="text-xs text-muted">
          <Trans>
            Idle thread unloading and execution limits can't be changed in this window yet.
          </Trans>
        </p>
      ) : null}
    </SettingsPage>
  );
}
