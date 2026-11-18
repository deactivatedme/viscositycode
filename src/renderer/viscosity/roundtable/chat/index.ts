/**
 * ViscosityCode: in-chat Roundtable entry points, as used by upstream's
 * composers (ThreadDraftComposerArea, ThreadComposerSection). Importing this
 * module registers the desktop-shell host that renders the invite dialog.
 *
 * Non-UI hook-ins import their own modules directly so pure code paths
 * (slash parsing, submit routing, palette commands) never pull in the dialog:
 * `./slashCommand`, `./composerHooks`, `./paletteCommands`.
 */
import { registerRoundtableChatHost } from "./RoundtableChatHost";

registerRoundtableChatHost();

export { RoundtableDraftPanel } from "./RoundtableDraftPanel";
export {
  startDraftRoundtable,
  useRoundtableDraft,
  type RoundtableDraftPrimary,
  type RoundtableDraftState,
} from "./useRoundtableDraft";
export {
  useRoundtableMentionItems,
  type RoundtableMentionItems,
} from "./useRoundtableMentionItems";
export type { RoundtableMentionTarget } from "./mentions";
