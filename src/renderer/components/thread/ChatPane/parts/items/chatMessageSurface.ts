// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
export const chatMessageSurfaceClass = "w-full rounded-3xl px-3 py-2";

/**
 * Surface for user-authored rows (the user message and the question/answer
 * prompt). A hairline border delineates them from transparent agent rows in
 * low-elevation themes where the tertiary fill alone is too subtle.
 */
// ViscosityCode: poracode-chat-prompt-surface is an unstyled hook for the desktop shell (layout/content.css).
export const chatPromptSurfaceClass = `poracode-chat-prompt-surface ${chatMessageSurfaceClass} relative border border-[var(--hairline)]`;
