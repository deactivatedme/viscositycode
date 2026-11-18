/**
 * ViscosityCode: the text a bot's brain receives about who it is (fork of
 * Poracode). Prompts go to the model, so they are plain English like the
 * app's other agent prompts (PR Ask, experiment judge); the UI around them is
 * localized.
 *
 * The bot's standing instructions and memory come from the user, so they are
 * framed as the user's own preferences. Nothing here raises a provider's
 * permissions: an agent bot runs with its provider's default approval and
 * sandbox settings, and approvals still go to the user.
 */
import type { BotProfile } from "./api";

type BotPersona = Pick<BotProfile, "label" | "instructions" | "memory">;

function personaLines(bot: BotPersona): string[] {
  const lines = [
    `You are "${bot.label}", a named, persistent AI teammate of the user. Keep this name and role for the whole conversation.`,
  ];
  const instructions = bot.instructions?.trim();
  if (instructions) {
    lines.push(
      "",
      "Standing instructions from the user (follow them in every reply):",
      instructions,
    );
  }
  const memory = bot.memory?.trim();
  if (memory) {
    lines.push("", "Your memory notes from earlier chats (use them as background):", memory);
  }
  return lines;
}

/**
 * First turn of an agent bot's ongoing thread: a short preamble the bot is
 * told to follow, ending with a one-line acknowledgement so the thread is
 * ready for the user's first real request.
 */
export function buildAgentBotPreamble(bot: BotPersona): string {
  return [
    ...personaLines(bot),
    "",
    "Reply with one short line saying you are ready, then wait for the user's first request. Do not start any work yet.",
  ].join("\n");
}

/** Responses API `instructions` for a Grok (xAI API) bot. */
export function buildXaiBotInstructions(bot: BotPersona): string {
  return personaLines(bot).join("\n");
}
