/**
 * ViscosityCode: the component registered as Mission Control's Cloud tab
 * (fork of Poracode). The panel loads on first open, so startup only pays for
 * this wrapper.
 */
import { lazy, Suspense } from "react";

const CloudAgentsPanel = lazy(() =>
  import("./CloudAgentsPanel").then((module) => ({ default: module.CloudAgentsPanel })),
);

export function CloudAgentsTab() {
  return (
    <Suspense fallback={<div className="h-full" aria-busy="true" />}>
      <CloudAgentsPanel />
    </Suspense>
  );
}
