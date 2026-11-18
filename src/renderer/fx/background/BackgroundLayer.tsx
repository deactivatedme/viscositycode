/**
 * ViscosityCode: the animated background layer (Step 3), mounted once by
 * FxRoot inside the desktop shell.
 *
 * While enabled it portals one fixed, inert host into <body> (behind every
 * app layer, see background.css), hands it to a BackgroundController that owns
 * the canvas and frame loop, and switches the shell's panels to translucent
 * (html[data-vc-bg="on"] + --vc-panel-alpha / --vc-panel-blur). Disabling or
 * unmounting releases the canvas, its WebGL context and the <html> state.
 *
 * React only re-renders for the switch and the two panel values; every other
 * setting reaches the controller through a store subscription, and frames
 * never touch React. Style and intensity follow the focused project's
 * override when it has one (Step 5, ./projectBackground.ts).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFxSettings } from "../fxSettingsStore";
import { BackgroundController } from "./backgroundController";
import { applyBackgroundDom, clearBackgroundDom } from "./backgroundDom";
import { createEffectiveBackgroundSource } from "./projectBackground";
import {
  debugRendererPreference,
  installBackgroundDebugHook,
  registerBackgroundDebug,
} from "./debugHook";

export function BackgroundLayer() {
  const enabled = useFxSettings((state) => state.background.enabled);
  const panelOpacity = useFxSettings((state) => state.background.panelOpacity);
  const panelBlur = useFxSettings((state) => state.background.panelBlur);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) installBackgroundDebugHook();
  }, []);

  // Declared before the panel effect so the canvas has drawn its first frame
  // when the panels turn translucent (both run in the same task).
  useEffect(() => {
    if (!host) return;
    const source = createEffectiveBackgroundSource();
    const controller = new BackgroundController(host, source.get(), {
      rendererPreference: debugRendererPreference(),
    });
    const unsubscribe = source.subscribe((next) => controller.update(next));
    const unregisterDebug = registerBackgroundDebug(controller);
    return () => {
      unsubscribe();
      unregisterDebug();
      controller.dispose();
    };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    const root = document.documentElement;
    applyBackgroundDom(root, { panelOpacity, panelBlur });
    return () => clearBackgroundDom(root);
  }, [host, panelOpacity, panelBlur]);

  if (!enabled || typeof document === "undefined") return null;
  return createPortal(
    <div ref={setHost} className="vc-bg-layer" aria-hidden="true" />,
    document.body,
  );
}
