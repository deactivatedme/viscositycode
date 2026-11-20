/**
 * ViscosityCode: agent-facing text for a chat's playbook (`ThreadConfig.playbook`,
 * src/shared/viscosity/playbook.ts). Structured chats receive the brief through
 * the per-turn crew-brief channel (`turnClientContext.ts`); terminal chats get
 * one typed line pointing at a generated instructions file, like skill path
 * hints, instead of kilobytes pasted into a TUI.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { resolvePoracodeChannel, userDataDirNameFor } from "@/shared/channel";
import type { ProjectLocation } from "@/shared/contracts";
import type { PromptSegment } from "@/shared/contracts/thread";
import { poracodeBaseDirFromEnv } from "@/shared/poracodePaths";
import {
  playbookFingerprint,
  threadPlaybookBinding,
  type ThreadConfigPlaybook,
  type ThreadPlaybookBinding,
} from "@/shared/viscosity/playbook";
import { batchWslCommandsAsync, quotePosixShellArg } from "../agents/base";
import { rewriteSegmentsForWorkspace } from "./threadAttachments";

export const PLAYBOOK_REMOVED_BRIEF_TEXT =
  "[playbook] The user removed this chat's playbook. Its instructions no longer apply.";

export const PLAYBOOK_READ_ONLY_TEXT =
  "Do not create, edit or delete project files in this chat, and do not ask helpers to; report findings and proposed changes instead. If the user explicitly asks for an edit, make only that edit.";

export const PLAYBOOK_POINTER_REMOVED_TEXT =
  "This chat's playbook no longer applies; ignore its instructions file.";

function playbookBody(binding: ThreadPlaybookBinding): string {
  return binding.readOnly
    ? `${binding.instructions}\n\n${PLAYBOOK_READ_ONLY_TEXT}`
    : binding.instructions;
}

export function playbookSetBriefText(binding: ThreadPlaybookBinding): string {
  return `[playbook] This chat uses the ${JSON.stringify(binding.label)} playbook. Follow these standing instructions until told the playbook changed; they replace any earlier playbook instructions in this conversation:\n${playbookBody(binding)}`;
}

export function playbookChangedBriefText(binding: ThreadPlaybookBinding): string {
  return `[playbook] The playbook changed to ${JSON.stringify(binding.label)}. Drop the previous playbook's instructions and follow these:\n${playbookBody(binding)}`;
}

/**
 * Delivery state for a session that resumes an existing provider conversation
 * this process never briefed. A cleared playbook (`null`) is then announced
 * once, since the resumed conversation may still hold the old instructions; a
 * live playbook needs no seed because its set text replaces earlier ones.
 */
export const PLAYBOOK_RESUMED_DELIVERY = "resumed";

export function resumedPlaybookDelivered(
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
): string | undefined {
  return config?.playbook === null ? PLAYBOOK_RESUMED_DELIVERY : undefined;
}

/** A restart resumes the same conversation, so it keeps what that conversation was told. */
export function restartedPlaybookDelivery(
  session: { readonly playbookBriefDelivered?: string | undefined },
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
): { playbookBriefDelivered?: string } {
  const delivered = session.playbookBriefDelivered ?? resumedPlaybookDelivered(config);
  return delivered === undefined ? {} : { playbookBriefDelivered: delivered };
}

/** The playbook the agent has not been told about yet: a new binding, or none after one was delivered. */
function duePlaybook(
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
  delivered: string | undefined,
): { fingerprint: string; binding?: ThreadPlaybookBinding } | undefined {
  const binding = threadPlaybookBinding(config);
  const fingerprint = playbookFingerprint(binding);
  if (fingerprint === (delivered ?? "")) return undefined;
  return binding ? { fingerprint, binding } : { fingerprint };
}

/** Structured-turn brief (set, changed or removed), or undefined when nothing is due. */
export function playbookBriefForConfig(
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
  delivered: string | undefined,
): { fingerprint: string; text: string } | undefined {
  const due = duePlaybook(config, delivered);
  if (!due) return undefined;
  if (!due.binding) return { fingerprint: "", text: PLAYBOOK_REMOVED_BRIEF_TEXT };
  return {
    fingerprint: due.fingerprint,
    text: delivered ? playbookChangedBriefText(due.binding) : playbookSetBriefText(due.binding),
  };
}

function defaultPlaybookBriefDir(): string {
  // The supervisor's own data-folder seam (see supervisorRuntime.ts), so scratch profiles stay scratch.
  const baseDir =
    poracodeBaseDirFromEnv() ?? join(homedir(), userDataDirNameFor(resolvePoracodeChannel()));
  return join(baseDir, "playbooks");
}

export interface PlaybookBriefFileOptions {
  /** Directory for the generated files; defaults to `<data folder>/playbooks`. */
  readonly dir?: string;
  /**
   * The agent can only read files inside its project
   * (`requiresWorkspaceLocalAttachments`): copy the file into the workspace like
   * attachments. Ignored for WSL projects, whose path is translated instead.
   */
  readonly workspaceLocal?: boolean;
}

/**
 * Writes the set brief to a content-addressed, disposable file and returns the
 * path the agent can read (a Linux path for WSL projects). Rewritten on every
 * call, so a deleted file is recreated.
 */
export async function writePlaybookBriefFile(
  binding: ThreadPlaybookBinding,
  location: ProjectLocation,
  options: PlaybookBriefFileOptions = {},
): Promise<string> {
  const dir = options.dir ?? defaultPlaybookBriefDir();
  const name = createHash("sha256").update(playbookFingerprint(binding)).digest("hex").slice(0, 24);
  const filePath = join(dir, `${name}.md`);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `${playbookSetBriefText(binding)}\n`, "utf8");
  if (location.kind !== "wsl") {
    if (!options.workspaceLocal) return filePath;
    const [copied] = await rewriteSegmentsForWorkspace(
      [{ kind: "file", path: filePath }],
      location.path,
    );
    const copiedPath = copied?.kind === "file" ? copied.path : filePath;
    // An unreadable pointer must not count as delivered; the caller retries next prompt.
    if (copiedPath === filePath)
      throw new Error("could not copy the playbook file into the workspace");
    return copiedPath;
  }
  const [result] = await batchWslCommandsAsync(location.distro, [
    `wslpath -a -u -- ${quotePosixShellArg(filePath)}`,
  ]);
  // A host path is unreadable in Linux, and login-shell chatter adds lines that would submit the TUI prompt early.
  const linuxPath = result?.ok ? result.stdout.trim() : "";
  if (!posix.isAbsolute(linuxPath) || /[\r\n]/u.test(linuxPath))
    throw new Error("wslpath could not translate the playbook file");
  return linuxPath;
}

/**
 * The one-line pointer a terminal chat's next app-sent prompt must lead with,
 * or undefined when the agent already has the current playbook. The line
 * never contains a newline, so it cannot submit a TUI prompt early.
 */
export async function terminalPlaybookPointer(
  config: { playbook?: ThreadConfigPlaybook | undefined } | undefined,
  delivered: string | undefined,
  location: ProjectLocation,
  options: PlaybookBriefFileOptions = {},
): Promise<{ fingerprint: string; text: string } | undefined> {
  const due = duePlaybook(config, delivered);
  if (!due) return undefined;
  if (!due.binding) return { fingerprint: "", text: PLAYBOOK_POINTER_REMOVED_TEXT };
  let path: string;
  try {
    path = await writePlaybookBriefFile(due.binding, location, options);
  } catch (error) {
    // Never block a prompt on this file; the next app-sent prompt retries.
    console.warn("[supervisor] playbook instructions file could not be written:", error);
    return undefined;
  }
  const label = JSON.stringify(due.binding.label.replace(/\s+/g, " "));
  return {
    fingerprint: due.fingerprint,
    text: `Follow the standing instructions in ${path} for this chat (${label} playbook).`,
  };
}

/**
 * Whether a terminal prompt opens with a command or skill (a leading `/` or
 * skill segment): TUIs dispatch those only at the very start of the input, so
 * a pointer in front would turn them into plain text. The pointer then waits
 * for the next plain prompt. Unlike the structured path's advertised-command
 * check, any leading `/` counts: terminal agents advertise few of their commands.
 */
export function leadsWithTerminalCommand(
  prompt: string,
  segments: readonly PromptSegment[] | undefined,
): boolean {
  const lead = segments?.find((segment) => segment.kind !== "text" || segment.content.trim());
  if (lead?.kind === "skill") return true;
  const text = lead ? (lead.kind === "text" ? lead.content : "") : prompt;
  return text.trimStart().startsWith("/");
}

/** Leads `segments` with the pointer text; an absent or empty list is returned unchanged. */
export function withPlaybookPointerSegment(
  pointer: string | undefined,
  segments: PromptSegment[] | undefined,
): PromptSegment[] | undefined {
  if (!pointer || !segments?.length) return segments;
  return [{ kind: "text", content: `${pointer} ` }, ...segments];
}

/** Leads a plain (segment-less) prompt with the pointer text. */
export function withPlaybookPointerText(
  pointer: string | undefined,
  segments: readonly PromptSegment[] | undefined,
  prompt: string,
): string {
  return pointer && !segments?.length ? `${pointer} ${prompt}` : prompt;
}
