/**
 * ViscosityCode: the main sidebar's footer in the desktop shell (replaces
 * upstream's SidebarFooterNav there). An avatar initial and the viewer's name
 * (`profileIdentity.ts`: the name they typed, else the OS account name), with
 * a menu for Rename, Settings, Remote Access, What's new, feedback and Hide
 * sidebar. Rename turns the name into a text field. Upstream's update and
 * What's New entries render above it (What's New keeps its unread dot); the
 * workspace switcher is left out on purpose (Settings → Workspaces still
 * manages workspaces). Styles: ../activityBar.css.
 */
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Bug, ChevronsUpDown, Megaphone, PanelLeftClose, Pencil, Settings2 } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { openRemoteAccessSettings, openSettings } from "@/renderer/actions/panelActions";
import { readBridge } from "@/renderer/bridge";
import { feedbackDestination } from "@/renderer/components/common/feedbackService";
import { getProviderModelPickerRank } from "@/renderer/components/providers/providerManifest";
import { DeferredFeedbackDialog, DeferredSettingsOverlay } from "@/renderer/deferredFeatures";
import { useChangelogStore } from "@/renderer/state/changelogStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import {
  RemoteAccessSidebarIcon,
  type RemoteAccessSidebarStatus,
} from "@/renderer/views/MainView/parts/Sidebar/parts/RemoteAccessSidebarIcon";
import { UpdateButtons } from "@/renderer/views/MainView/parts/Sidebar/parts/UpdateButtons";
import { WhatsNewButton } from "@/renderer/views/MainView/parts/Sidebar/parts/WhatsNewButton";
import {
  PROFILE_NAME_MAX_LENGTH,
  pickProfileName,
  profileInitial,
  readOsUserName,
} from "./profileIdentity";
import { useProfileNameStore } from "./profileNameStore";

function prewarmSettings(): void {
  void DeferredSettingsOverlay.preload();
}

interface ProfileMenuEntry {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

/** The name as a text field: Enter or leaving it saves, Escape cancels (null). */
function ProfileNameInput(props: { initialValue: string; onDone: (value: string | null) => void }) {
  const { t } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [value, setValue] = useState(props.initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function done(next: string | null) {
    if (doneRef.current) return;
    doneRef.current = true;
    props.onDone(next);
  }

  return (
    <input
      ref={inputRef}
      aria-label={t`Your name`}
      className="vc-sidebar-profile__name block w-full bg-transparent outline-none"
      maxLength={PROFILE_NAME_MAX_LENGTH}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => done(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        // Enter that confirms an IME composition (CJK names) is not a save.
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") done(value);
        if (event.key === "Escape") done(null);
      }}
    />
  );
}

export function SidebarProfileRow(props: {
  remoteAccessStatus: RemoteAccessSidebarStatus;
  showRemoteAccess: boolean;
}) {
  const { t } = useLingui();
  const { collapse } = useSidebar();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const customName = useProfileNameStore((state) => state.name);
  const name =
    pickProfileName({
      customName,
      osUserName: readOsUserName(),
      snapshots,
      rank: getProviderModelPickerRank,
    }) ?? t`Account`;
  const feedbackTarget = feedbackDestination();

  useEffect(() => {
    // Enter and Escape drop focus with the text field: put it back on the row.
    if (wasRenaming.current && !renaming && document.activeElement === document.body) {
      triggerRef.current?.focus();
    }
    wasRenaming.current = renaming;
  }, [renaming]);

  function finishRename(value: string | null) {
    // A blank name forgets the typed one, so the default shows again.
    if (value !== null && value.trim() !== name) useProfileNameStore.getState().setName(value);
    setRenaming(false);
  }

  const entries: ProfileMenuEntry[] = [
    {
      key: "rename",
      label: t`Rename`,
      icon: <Pencil className="size-4" />,
      onPress: () => setRenaming(true),
    },
    {
      key: "settings",
      label: t`Settings`,
      icon: <Settings2 className="size-4" />,
      onPress: openSettings,
    },
    ...(props.showRemoteAccess
      ? [
          {
            key: "remoteAccess",
            label: t`Remote Access`,
            icon: <RemoteAccessSidebarIcon status={props.remoteAccessStatus} />,
            onPress: openRemoteAccessSettings,
          },
        ]
      : []),
    {
      key: "whatsNew",
      label: t`What's New`,
      icon: <Megaphone className="size-4" />,
      onPress: () => useChangelogStore.getState().openWhatsNew(),
    },
    ...(feedbackTarget
      ? [
          {
            key: "feedback",
            label: t`Send feedback`,
            icon: <Bug className="size-4" />,
            onPress: () => {
              if (feedbackTarget.kind === "external") {
                void readBridge().openExternal(feedbackTarget.url);
              } else {
                setFeedbackOpen(true);
              }
            },
          },
        ]
      : []),
    {
      key: "hideSidebar",
      label: t`Hide sidebar`,
      icon: <PanelLeftClose className="size-4" />,
      onPress: collapse,
    },
  ];

  return (
    <div className="vc-sidebar-profile">
      <UpdateButtons />
      <WhatsNewButton />
      {renaming ? (
        <div className="vc-sidebar-profile__row shadow-[inset_0_0_0_1px_var(--vc-focus-ring)]">
          <span aria-hidden="true" className="vc-sidebar-profile__avatar">
            {profileInitial(name)}
          </span>
          <ProfileNameInput initialValue={name} onDone={finishRename} />
        </div>
      ) : (
        <Dropdown
          onOpenChange={(open) => {
            if (open) prewarmSettings();
          }}
        >
          <Dropdown.Trigger
            ref={triggerRef}
            className="vc-sidebar-profile__row"
            aria-label={t`Account menu`}
          >
            <span aria-hidden="true" className="vc-sidebar-profile__avatar">
              {profileInitial(name)}
            </span>
            <span className="vc-sidebar-profile__name">{name}</span>
            <ChevronsUpDown aria-hidden="true" className="vc-sidebar-profile__chevron" />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="top start">
            <Dropdown.Menu
              aria-label={t`Account menu`}
              className="poracode-menu min-w-48"
              onAction={(key) => entries.find((entry) => entry.key === String(key))?.onPress()}
            >
              {entries.map((entry) => (
                <Dropdown.Item key={entry.key} id={entry.key} textValue={entry.label}>
                  <span className="flex size-4 shrink-0 items-center justify-center text-muted">
                    {entry.icon}
                  </span>
                  <Label>{entry.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      )}
      {feedbackOpen ? (
        <Suspense fallback={null}>
          <DeferredFeedbackDialog isOpen={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
