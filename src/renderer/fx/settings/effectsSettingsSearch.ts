/**
 * ViscosityCode: settings-search entries for Settings → Effects, spread into
 * the shared `SETTINGS_SEARCH_INDEX`.
 *
 * As upstream's index requires, each `title`/`description` is byte-identical to
 * the string the row renders (so both resolve to one catalog entry) and each
 * `anchor` matches the row's `anchorId`. `EffectsSettings.test.tsx` renders the
 * section and checks every entry against its row, so drift fails loudly.
 *
 * Effects are client preferences that also show in a desktop-width browser
 * client, so no entry is `desktopOnly`.
 */
import { msg } from "@lingui/core/macro";
import type { SettingsSearchEntry } from "@/renderer/views/SettingsOverlay/parts/settingsSearchIndex";

export const EFFECTS_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // Background
  {
    section: "effects",
    anchor: "effects.background",
    title: msg`Animated background`,
    description: msg`Draw a slow, animated backdrop behind the app's panels.`,
    keywords: "background wallpaper backdrop animation animated effects motion webgl",
  },
  {
    section: "effects",
    anchor: "effects.backgroundStyle",
    title: msg`Style`,
    description: msg`The look of the animated background.`,
    keywords: "background preset gradient mesh particle field aurora grid look",
  },
  {
    section: "effects",
    anchor: "effects.backgroundIntensity",
    title: msg`Intensity`,
    description: msg`Brightness, contrast, and speed of the background.`,
    keywords: "background strength brightness contrast speed subtle vivid",
  },
  {
    section: "effects",
    anchor: "effects.fpsCap",
    title: msg`Frame-rate cap`,
    description: msg`Highest frame rate for the background. Lower values use less power.`,
    keywords: "fps frames per second framerate performance power cpu gpu 15 30 60",
  },
  {
    section: "effects",
    anchor: "effects.panelOpacity",
    title: msg`Panel opacity`,
    description: msg`How solid panels look over the background. Lower shows more of it.`,
    keywords: "transparency translucent see-through panels glass background",
  },
  {
    section: "effects",
    anchor: "effects.panelBlur",
    title: msg`Panel blur`,
    description: msg`How much the background is blurred behind panels.`,
    keywords: "frosted glass blur backdrop panels background",
  },
  {
    section: "effects",
    anchor: "effects.pauseWhenUnfocused",
    title: msg`Pause when the window is not focused`,
    description: msg`Stop animating while you work in another app.`,
    keywords: "pause background unfocused inactive window power battery",
  },
  {
    section: "effects",
    anchor: "effects.respectReducedMotion",
    title: msg`Pause when the system asks to reduce motion`,
    description: msg`Off by default, so the background keeps animating even with Reduce Motion on in macOS or animation effects off in Windows.`,
    keywords: "reduce reduced motion accessibility animation effects macos windows pause",
  },
  {
    section: "effects",
    anchor: "effects.batterySaver",
    title: msg`Battery saver`,
    description: msg`Slow the background down on battery power and stop it when the battery is low.`,
    keywords: "battery power laptop energy saver low pause background",
  },

  // Per-project backgrounds
  {
    section: "effects",
    anchor: "effects.projectBackgrounds",
    title: msg`Per-project backgrounds`,
    description: msg`Give a project its own background style or intensity. It applies while that project's thread or draft is in focus; other projects use the settings above.`,
    keywords: "project background override style preset intensity per project workspace repo",
  },

  // Agent effects
  {
    section: "effects",
    anchor: "effects.agentEffects",
    title: msg`Agent effects`,
    description: msg`Show live effects for what agents are doing. Turn off to hide them all.`,
    keywords: "agent state status effects animation glow live activity",
  },
  {
    section: "effects",
    anchor: "effects.thinkingGlow",
    title: msg`Thinking glow`,
    description: msg`A soft pulse while an agent is reasoning.`,
    keywords: "thinking reasoning glow pulse agent",
  },
  {
    section: "effects",
    anchor: "effects.streamingEnergy",
    title: msg`Streaming energy`,
    description: msg`The background picks up while an agent streams a reply.`,
    keywords: "streaming reply energy background speed agent",
  },
  {
    section: "effects",
    anchor: "effects.toolIndicator",
    title: msg`Tool activity indicator`,
    description: msg`Marks threads that are running a tool or command.`,
    keywords: "tool command running indicator activity agent",
  },
  {
    section: "effects",
    anchor: "effects.attentionColor",
    title: msg`Attention color when an agent needs you`,
    description: msg`Highlights threads that are waiting for your approval or reply.`,
    keywords: "attention approval reply waiting needs input color colour highlight",
  },
  {
    section: "effects",
    anchor: "effects.errorFlash",
    title: msg`Error flash`,
    description: msg`A brief flash when an agent hits an error.`,
    keywords: "error failure flash alert agent",
  },
  {
    section: "effects",
    anchor: "effects.completionAnimation",
    title: msg`Completion animation`,
    description: msg`A short animation when an agent finishes its turn.`,
    keywords: "done finished complete completion animation celebrate agent",
  },
  {
    section: "effects",
    anchor: "effects.typingGlow",
    title: msg`Typing glow`,
    description: msg`The composer glows softly while you type.`,
    keywords: "typing composer input glow keyboard",
  },

  // Sounds
  {
    section: "effects",
    anchor: "effects.sounds",
    title: msg`Sound cues`,
    description: msg`Play a short sound when an agent finishes, hits an error, or needs your approval. While on, these replace the notification sound.`,
    keywords: "sound sounds audio chime beep cue pack notification alert agent",
  },
  {
    section: "effects",
    anchor: "effects.soundVolume",
    title: msg`Volume`,
    description: msg`How loud the sound cues play.`,
    keywords: "sound volume loud quiet audio level cue",
  },
  {
    section: "effects",
    anchor: "effects.soundAlsoInFront",
    title: msg`Also when the app is in front`,
    description: msg`Otherwise cues play only while the app is in the background or the thread is not on screen.`,
    keywords: "sound focused foreground visible window front always play cue",
  },
  {
    section: "effects",
    anchor: "effects.soundDone",
    title: msg`Agent finished`,
    description: msg`A soft rising chime when an agent finishes its turn.`,
    keywords: "sound done finished complete chime turn cue",
  },
  {
    section: "effects",
    anchor: "effects.soundError",
    title: msg`Agent error`,
    description: msg`Two low, falling notes when an agent hits an error.`,
    keywords: "sound error failure tone cue",
  },
  {
    section: "effects",
    anchor: "effects.soundAttention",
    title: msg`Needs your approval`,
    description: msg`A gentle double tap when an agent waits for your approval or reply.`,
    keywords: "sound approval attention reply waiting needs input cue",
  },

  // Notifications and reset
  {
    section: "effects",
    anchor: "effects.approvalNotifications",
    title: msg`Notify me when an agent needs approval while the window is in the background`,
    description: msg`Handled by your notification settings (Needs Attention), so you never get the same alert twice.`,
    keywords: "notification notify alert approval background unfocused needs attention sound",
  },
  {
    section: "effects",
    anchor: "effects.reset",
    title: msg`Reset effects to defaults`,
    description: msg`Restore every background and agent effect setting on this device.`,
    keywords: "reset restore defaults effects background",
  },
];
