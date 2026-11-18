/**
 * ViscosityCode: the host-composed notices of account-pool failover.
 *
 * Host strings follow the `@/shared/messages` convention (English templates
 * with `{param}` placeholders, composed where the decision is made); clients
 * only display what the host emits. Notices name accounts by their agent
 * labels and never carry credentials, environments or raw provider payloads.
 */

export type AccountPoolNoticeKind = "switched" | "exhausted" | "switch-failed" | "terminal";

export interface AccountPoolNotice {
  kind: AccountPoolNoticeKind;
  threadId: string;
  title: string;
  body: string;
}

const templates = {
  switchedTitle: "Switched to {to}",
  switchedBody: "{from} is out of usage, so “{thread}” continues on {to}.",
  exhaustedTitle: "{provider} accounts are out of usage",
  exhaustedBodyUntil: "All {provider} accounts in your pool are out of usage until {time}.",
  exhaustedBody: "All {provider} accounts in your pool are out of usage.",
  exhaustedSignInHint: "{count} more need sign-in before they can take over.",
  switchFailedTitle: "Couldn't switch accounts",
  switchFailedBody: "{from} is out of usage, but “{thread}” could not move to {to}: {error}",
  terminalTitle: "{from} is out of usage",
  terminalBody:
    "Terminal threads can't switch accounts in place. Use Continue in provider to move “{thread}” to {to}.",
} as const;

const MAX_DETAIL_LENGTH = 200;

function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match);
}

/** Bounded, single-line error detail: notices never relay a multi-line payload. */
export function noticeDetail(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text;
}

/** Default reset-time rendering for host notices (host locale and time zone). */
export function formatResetTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function switchedNotice(input: {
  threadId: string;
  threadTitle: string;
  fromLabel: string;
  toLabel: string;
}): AccountPoolNotice {
  const params = { from: input.fromLabel, to: input.toLabel, thread: input.threadTitle };
  return {
    kind: "switched",
    threadId: input.threadId,
    title: fill(templates.switchedTitle, params),
    body: fill(templates.switchedBody, params),
  };
}

/** The one clear message when no account in the pool can take the work over. */
export function exhaustedMessage(input: {
  providerLabel: string;
  until?: string;
  notReadyCount: number;
}): string {
  const params = { provider: input.providerLabel, time: input.until ?? "" };
  const base = fill(
    input.until === undefined ? templates.exhaustedBody : templates.exhaustedBodyUntil,
    params,
  );
  return input.notReadyCount > 0
    ? `${base} ${fill(templates.exhaustedSignInHint, { count: String(input.notReadyCount) })}`
    : base;
}

export function exhaustedNotice(input: {
  threadId: string;
  providerLabel: string;
  message: string;
}): AccountPoolNotice {
  return {
    kind: "exhausted",
    threadId: input.threadId,
    title: fill(templates.exhaustedTitle, { provider: input.providerLabel }),
    body: input.message,
  };
}

export function switchFailedMessage(input: {
  threadTitle: string;
  fromLabel: string;
  toLabel: string;
  error: unknown;
}): string {
  return fill(templates.switchFailedBody, {
    from: input.fromLabel,
    to: input.toLabel,
    thread: input.threadTitle,
    error: noticeDetail(input.error),
  });
}

export function switchFailedNotice(input: {
  threadId: string;
  message: string;
}): AccountPoolNotice {
  return {
    kind: "switch-failed",
    threadId: input.threadId,
    title: templates.switchFailedTitle,
    body: input.message,
  };
}

export function terminalNotice(input: {
  threadId: string;
  threadTitle: string;
  fromLabel: string;
  toLabel: string;
}): AccountPoolNotice {
  const params = { from: input.fromLabel, to: input.toLabel, thread: input.threadTitle };
  return {
    kind: "terminal",
    threadId: input.threadId,
    title: fill(templates.terminalTitle, params),
    body: fill(templates.terminalBody, params),
  };
}
