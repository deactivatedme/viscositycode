/**
 * ViscosityCode: the main sidebar's footer in the desktop shell (replaces
 * upstream's SidebarFooterNav there). An avatar initial, the signed-in
 * account's name and a muted plan from the first provider usage snapshot,
 * with a menu for Settings, Remote Access, What's new, feedback and Hide
 * sidebar. Upstream's workspace, update and What's New entries render above it
 * (What's New keeps its unread dot). Styles: ../activityBar.css.
 */
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Bug, ChevronsUpDown, Megaphone, PanelLeftClose, Settings2 } from "lucide-react";
import { type ReactNode, Suspense, useState } from "react";
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
import { SidebarWorkspaceSwitcher } from "@/renderer/views/MainView/parts/Sidebar/parts/SidebarWorkspaceSwitcher";
import { UpdateButtons } from "@/renderer/views/MainView/parts/Sidebar/parts/UpdateButtons";
import { WhatsNewButton } from "@/renderer/views/MainView/parts/Sidebar/parts/WhatsNewButton";
import { pickProfileIdentity, profileInitial } from "./profileIdentity";

function prewarmSettings(): void {
  void DeferredSettingsOverlay.preload();
}

interface ProfileMenuEntry {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

export function SidebarProfileRow(props: {
  remoteAccessStatus: RemoteAccessSidebarStatus;
  showRemoteAccess: boolean;
}) {
  const { t } = useLingui();
  const { collapse } = useSidebar();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const snapshots = useProviderUsageStore((state) => state.snapshots);
  const identity = pickProfileIdentity(snapshots, getProviderModelPickerRank);
  const name = identity.name ?? t`Account`;
  const feedbackTarget = feedbackDestination();

  const entries: ProfileMenuEntry[] = [
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
      <SidebarWorkspaceSwitcher />
      <UpdateButtons />
      <WhatsNewButton />
      <Dropdown
        onOpenChange={(open) => {
          if (open) prewarmSettings();
        }}
      >
        <Dropdown.Trigger className="vc-sidebar-profile__row" aria-label={t`Account menu`}>
          <span aria-hidden="true" className="vc-sidebar-profile__avatar">
            {profileInitial(name)}
          </span>
          <span className="vc-sidebar-profile__name">{name}</span>
          {identity.plan ? (
            <span className="vc-sidebar-profile__plan">· {identity.plan}</span>
          ) : null}
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
      {feedbackOpen ? (
        <Suspense fallback={null}>
          <DeferredFeedbackDialog isOpen={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
