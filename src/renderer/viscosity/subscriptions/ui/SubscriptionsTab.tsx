/**
 * ViscosityCode: the component registered as Mission Control's Subscriptions
 * tab (fork of Poracode). The dashboard loads on first open, so startup only
 * pays for this wrapper.
 */
import { lazy, Suspense } from "react";

const SubscriptionsDashboard = lazy(() =>
  import("./SubscriptionsDashboard").then((module) => ({ default: module.SubscriptionsDashboard })),
);

export function SubscriptionsTab() {
  return (
    <Suspense fallback={<div className="h-full" aria-busy="true" />}>
      <SubscriptionsDashboard />
    </Suspense>
  );
}
