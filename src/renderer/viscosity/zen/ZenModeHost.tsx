/**
 * ViscosityCode: Zen mode host (fork of Poracode).
 *
 * Mounted once inside the desktop shell's center frame. While zen mode is on
 * it portals the top reveal band and the floating "Exit Zen" pill into <body>,
 * listens for Escape and keeps the focused pane tagged. Unmounting (the window
 * leaves the desktop shell, e.g. turns compact) always turns zen mode off.
 */
import { useEffect, useId, useRef, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Shrink } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { installZenEscapeListener } from "./zenEscape";
import { startZenFocusPaneTracker } from "./zenFocusPane";
import { exitZenMode, useZenModeStore } from "./zenModeStore";
import { startZenPillReserve } from "./zenPillReserve";
import { startZenReveal } from "./zenReveal";

/** Re-tag the focused pane only when focus or the pane layout changes, never on streaming deltas. */
function subscribePaneChanges(listener: () => void): () => void {
  return useAppStore.subscribe((state, previous) => {
    if (state.focusedPaneId !== previous.focusedPaneId || state.view !== previous.view) listener();
  });
}

function readFocusedPaneId(): string | null {
  return useAppStore.getState().focusedPaneId;
}

function readPaneIds(): readonly string[] {
  const view = useAppStore.getState().view;
  return view.kind === "thread" ? view.panes : [];
}

/**
 * Leaves zen mode. Focus inside the zen chrome (the pill) would be lost when it
 * unmounts, so it goes back to where it came from; focus anywhere else stays put.
 */
function exitZenReturningFocus(chrome: HTMLElement | null, returnFocus: HTMLElement | null): void {
  const focusInChrome = chrome?.contains(document.activeElement) ?? false;
  exitZenMode();
  if (focusInChrome && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

export function ZenModeHost() {
  const active = useZenModeStore((state) => state.active);
  useEffect(() => exitZenMode, []);
  if (!active || typeof document === "undefined") return null;
  return createPortal(<ZenChrome />, document.body);
}

function ZenChrome() {
  const { t } = useLingui();
  const chromeRef = useRef<HTMLDivElement>(null);
  const hotZoneRef = useRef<HTMLDivElement>(null);
  const keyHintId = useId();
  // Where keyboard focus was before it reached the pill, to hand it back on exit.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const disposeEscape = installZenEscapeListener(window, {
      onExit: () => exitZenReturningFocus(chromeRef.current, returnFocusRef.current),
    });
    const disposeTracker = startZenFocusPaneTracker({
      root: document,
      readFocusedPaneId,
      readPaneIds,
      subscribe: subscribePaneChanges,
    });
    const hotZone = hotZoneRef.current;
    const disposeReveal = hotZone
      ? startZenReveal({ root: document.documentElement, hotZone, document })
      : undefined;
    // The revealed tab strip keeps its right end clear of the pill.
    const pill = chromeRef.current?.querySelector<HTMLElement>("[data-vc-zen-exit]");
    const disposePillReserve = pill
      ? startZenPillReserve({ pill, root: document.documentElement })
      : undefined;
    return () => {
      disposeEscape();
      disposeTracker();
      disposeReveal?.();
      disposePillReserve?.();
    };
  }, []);

  function rememberReturnFocus(event: FocusEvent) {
    const previous = event.relatedTarget;
    if (previous instanceof HTMLElement) returnFocusRef.current = previous;
  }

  function exitFromPill() {
    const returnFocus = returnFocusRef.current;
    exitZenMode();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  const label = t`Exit Zen`;
  return (
    <div ref={chromeRef} data-vc-zen-chrome="">
      <div ref={hotZoneRef} aria-hidden="true" data-vc-zen-hotzone="" className="vc-zen-hotzone" />
      <Button
        size="sm"
        variant="secondary"
        aria-label={t`Exit Zen mode`}
        // The visible key hint doubles as the description ("Esc").
        aria-describedby={keyHintId}
        data-vc-zen-exit=""
        className="vc-zen-exit"
        onFocus={rememberReturnFocus}
        onPress={exitFromPill}
      >
        <Shrink aria-hidden="true" className="vc-zen-exit__icon" />
        <span>{label}</span>
        <kbd id={keyHintId} className="vc-zen-exit__key">
          Esc
        </kbd>
      </Button>
    </div>
  );
}
