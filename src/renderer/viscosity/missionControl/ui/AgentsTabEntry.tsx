/**
 * ViscosityCode Mission Control: the component registered as the "Agents"
 * tab (fork of Poracode). The board loads with the panel's first open, so
 * startup only pays for this wrapper.
 */
import { lazy, Suspense } from "react";

const AgentsTab = lazy(() =>
  import("./AgentsTab").then((module) => ({ default: module.AgentsTab })),
);

export function AgentsTabEntry() {
  return (
    <Suspense fallback={<div className="h-full" aria-busy="true" />}>
      <AgentsTab />
    </Suspense>
  );
}
