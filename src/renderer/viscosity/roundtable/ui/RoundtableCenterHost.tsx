/**
 * ViscosityCode Roundtable UI: the center-panel mount. Rendered by the fork's
 * center frame inside the desktop shell only; it draws the open Roundtable
 * over the split view (like the inline file editor) and the setup dialog.
 * Both surfaces load lazily on first use. While the panel is shown the panes
 * underneath are inert and focus moves into the panel (`coverSplitView`).
 */
import { lazy, Suspense, useEffect, useRef } from "react";
import { useCoverSplitView } from "./coverSplitView";
import {
  isRoundtablePanelShown,
  startRoundtableViewSync,
  useRoundtableViewStore,
} from "./roundtableViewStore";

const RoundtableView = lazy(() =>
  import("./RoundtableView").then((module) => ({ default: module.RoundtableView })),
);
const RoundtableSetupDialog = lazy(() =>
  import("./RoundtableSetupDialog").then((module) => ({
    default: module.RoundtableSetupDialog,
  })),
);

/** The panel over the split view; it keeps the panes underneath inert while mounted. */
function RoundtablePanel(props: { sessionId: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useCoverSplitView(panelRef);
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-vc-roundtable-panel=""
      data-vc-cover-panel=""
      className="vc-rt-panel absolute inset-0 z-[21] flex outline-none"
    >
      <Suspense fallback={null}>
        <RoundtableView key={props.sessionId} sessionId={props.sessionId} />
      </Suspense>
    </div>
  );
}

export function RoundtableCenterHost() {
  const sessionId = useRoundtableViewStore((state) =>
    isRoundtablePanelShown(state) ? state.openSessionId : null,
  );
  const setup = useRoundtableViewStore((state) => state.setup);

  useEffect(() => startRoundtableViewSync(), []);

  return (
    <>
      {sessionId ? <RoundtablePanel sessionId={sessionId} /> : null}
      {setup ? (
        <Suspense fallback={null}>
          <RoundtableSetupDialog key={setup.nonce} request={setup.request} />
        </Suspense>
      ) : null}
    </>
  );
}
