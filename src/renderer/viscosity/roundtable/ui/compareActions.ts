/**
 * ViscosityCode Roundtable UI: "Continue with this one" for the side-by-side
 * comparison — keep working with the best answer in its own thread.
 *
 * The thread opens through the sidebar's own `openThread` (focus, composer
 * hand-off, history warm-up, and reopening an inactive runtime), standalone:
 * a participant thread belongs to its Roundtable's thread group, and opening
 * a grouped thread the usual way brings up the whole group (every participant
 * side by side). Continuing with one answer shows only that thread.
 */
import { openThread } from "@/renderer/actions/threadActions";
import { hideEditorPanel } from "@/renderer/viscosity/layout/tabs/tabActions";
import { hideRoundtablePanel } from "./roundtableViewStore";

export function continueWithThread(threadId: string): void {
  hideEditorPanel();
  hideRoundtablePanel();
  openThread(threadId, { standalone: true });
}
