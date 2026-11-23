/** A guest runs Devin through their own authenticated, licensed desktop account. */
export const devinCodeShareSubscription = {
  id: "devin",
  acceptsAccount(): boolean {
    // A positive auth-state is set by the real credential probe. Mode and model
    // entitlements are checked by the guest's licensed Devin runtime.
    return true;
  },
};
