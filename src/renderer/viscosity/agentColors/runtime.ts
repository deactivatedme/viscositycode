/**
 * ViscosityCode: keeps the per-agent stylesheet and the on/off flag in the
 * document.
 *
 * Subscribes outside React to two small, rarely changing stores (the owner's
 * picks and the detected agents), so thread updates and streaming never touch
 * it. The <style> text is rewritten only when the generated CSS changes.
 */
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAgentColors } from "./agentColorsStore";
import { knownAgentKinds } from "./assignment";
import { buildAgentColorStylesheet } from "./stylesheet";

export const AGENT_COLORS_STYLE_ID = "vc-agent-colors";
/** On <html> while panes, tabs and sidebar threads are coloured by agent. */
export const AGENT_COLORS_ENABLED_ATTRIBUTE = "data-vc-agent-colors";

/**
 * Install the stylesheet and flag into `doc` and keep them current until the
 * returned disposer runs.
 */
export function installAgentColors(doc: Document = document): () => void {
  const style = doc.createElement("style");
  style.id = AGENT_COLORS_STYLE_ID;
  style.dataset.vcAgentColors = "";
  doc.head.append(style);

  let css = "";
  const render = () => {
    const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
    const { enabled, colors } = useAgentColors.getState();
    const next = buildAgentColorStylesheet({
      known: knownAgentKinds(agentStatuses, wslAgentStatuses),
      overrides: colors,
    });
    if (next !== css) {
      css = next;
      style.textContent = next;
    }
    doc.documentElement.toggleAttribute(AGENT_COLORS_ENABLED_ATTRIBUTE, enabled);
  };

  render();
  const unsubscribeColors = useAgentColors.subscribe((state, prev) => {
    if (state.enabled !== prev.enabled || state.colors !== prev.colors) render();
  });
  const unsubscribeStatuses = useAgentStatusesStore.subscribe((state, prev) => {
    if (
      state.agentStatuses !== prev.agentStatuses ||
      state.wslAgentStatuses !== prev.wslAgentStatuses
    ) {
      render();
    }
  });

  return () => {
    unsubscribeColors();
    unsubscribeStatuses();
    style.remove();
    doc.documentElement.removeAttribute(AGENT_COLORS_ENABLED_ATTRIBUTE);
  };
}

let uninstall: (() => void) | undefined;

/**
 * Install once per window; later calls are no-ops. Returns the disposer so a
 * hot reload of this feature can take its old stylesheet and listeners down.
 */
export function ensureAgentColorsInstalled(): (() => void) | undefined {
  if (uninstall || typeof document === "undefined" || !document.head) return undefined;
  const dispose = installAgentColors(document);
  uninstall = () => {
    uninstall = undefined;
    dispose();
  };
  return uninstall;
}
