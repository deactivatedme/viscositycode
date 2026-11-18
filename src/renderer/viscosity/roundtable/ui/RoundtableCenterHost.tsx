/**
 * ViscosityCode Roundtable UI: the center-panel mount. Rendered by the fork's
 * center frame inside the desktop shell only; it draws the open Roundtable
 * over the split view (like the inline file editor) and the setup dialog.
 * Both surfaces load lazily on first use.
 */
import { lazy, Suspense, useEffect } from "react";
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

export function RoundtableCenterHost() {
  const sessionId = useRoundtableViewStore((state) =>
    isRoundtablePanelShown(state) ? state.openSessionId : null,
  );
  const setup = useRoundtableViewStore((state) => state.setup);

  useEffect(() => startRoundtableViewSync(), []);

  return (
    <>
      {sessionId ? (
        <div data-vc-roundtable-panel="" className="vc-rt-panel absolute inset-0 z-[21] flex">
          <Suspense fallback={null}>
            <RoundtableView key={sessionId} sessionId={sessionId} />
          </Suspense>
        </div>
      ) : null}
      {setup ? (
        <Suspense fallback={null}>
          <RoundtableSetupDialog key={setup.nonce} request={setup.request} />
        </Suspense>
      ) : null}
    </>
  );
}
