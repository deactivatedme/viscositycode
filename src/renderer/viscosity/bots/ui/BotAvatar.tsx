/**
 * ViscosityCode Bots UI: a bot's avatar (glyph on its colour) with an optional
 * live-state dot. Decorative: rows carry the bot's name as text.
 */
import type { CSSProperties } from "react";
import type { BotProfile } from "../api";
import { botAvatarColorCss, botAvatarGlyph } from "../botModel";
import type { BotLiveState } from "./botLiveState";
import "./bots.css";

export function BotAvatar(props: {
  bot: Pick<BotProfile, "label" | "avatar">;
  size?: "sm" | "md" | "lg";
  state?: BotLiveState;
}) {
  const style = { "--vc-bot-color": botAvatarColorCss(props.bot.avatar?.color) } as CSSProperties;
  return (
    <span aria-hidden="true" className="vc-bot-avatar" data-size={props.size ?? "sm"} style={style}>
      <span className="vc-bot-avatar__glyph">{botAvatarGlyph(props.bot)}</span>
      {props.state && props.state !== "idle" ? (
        <span className="vc-bot-avatar__dot" data-state={props.state} />
      ) : null}
    </span>
  );
}

/** Overlapping avatars for a group chat row. */
export function BotAvatarStack(props: {
  bots: readonly Pick<BotProfile, "id" | "label" | "avatar">[];
}) {
  if (props.bots.length === 0) return null;
  return (
    <span className="vc-bots-avatar-stack" aria-hidden="true">
      {props.bots.map((bot) => (
        <BotAvatar key={bot.id} bot={bot} size="sm" />
      ))}
    </span>
  );
}
