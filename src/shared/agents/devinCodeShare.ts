/** A guest runs Devin through their own authenticated, licensed desktop account. */
export const devinCodeShareSubscription = {
  id: "devin",
  modelLabel(id: string): string | undefined {
    // These IDs and labels are from the native Devin model catalog.
    if (id === "claude-fable-5-2-medium") return "Claude Fable 5.2";
    if (id === "gpt-6-2-astra-medium") return "GPT-6.2 Astra";
    return undefined;
  },
  acceptsAccount(): boolean {
    // A positive auth-state is set by the real credential probe. Mode and model
    // entitlements are checked by the guest's licensed Devin runtime.
    return true;
  },
};
