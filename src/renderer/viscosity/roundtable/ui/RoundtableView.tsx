/**
 * ViscosityCode Roundtable UI: one session, drawn over the center split view
 * (header, transcript, controls, composer). Mounted by `RoundtableCenterHost`
 * while the panel is shown; closing it returns to the threads underneath.
 *
 * Additive (AA compare): a "compare" session shows its answers side by side
 * instead of the transcript, and takes no messages (everyone answers once).
 */
import { Button } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { useRoundtableSession } from "../api";
import { patternIsAnswerOnly } from "./patterns";
import { RoundtableCompareView } from "./RoundtableCompareView";
import { RoundtableComposer, RoundtableControls } from "./RoundtableControls";
import { RoundtableHeader } from "./RoundtableHeader";
import { RoundtableTranscript } from "./RoundtableTranscript";
import { closeRoundtableView } from "./roundtableViewStore";

export function RoundtableView(props: { sessionId: string }) {
  const session = useRoundtableSession(props.sessionId);
  if (!session) {
    return (
      <section className="vc-rt-view" data-vc-roundtable-view="">
        <div className="vc-rt-view__missing">
          <p className="text-sm text-muted">
            <Trans>This Roundtable is not available. It may have been deleted.</Trans>
          </p>
          <Button size="sm" variant="tertiary" onPress={closeRoundtableView}>
            <Trans>Back to threads</Trans>
          </Button>
        </div>
      </section>
    );
  }
  const answerOnly = patternIsAnswerOnly(session.pattern);
  return (
    <section
      className="vc-rt-view"
      data-vc-roundtable-view={session.id}
      data-status={session.status}
      data-pattern={session.pattern}
      aria-label={session.title}
    >
      <RoundtableHeader session={session} />
      {answerOnly ? (
        <RoundtableCompareView session={session} />
      ) : (
        <RoundtableTranscript session={session} />
      )}
      <footer className="vc-rt-footer">
        <RoundtableControls session={session} />
        {answerOnly ? null : <RoundtableComposer session={session} />}
      </footer>
    </section>
  );
}
