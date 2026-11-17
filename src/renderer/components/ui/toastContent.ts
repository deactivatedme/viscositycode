// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import type { ReactNode } from "react";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
// ViscosityCode: toast text is often raw engine text; brand it for display only.
import { brandDisplayText } from "@/renderer/i18n/brandDisplay";

const LONG_ERROR_TITLE_CHARS = 160;
const LONG_ERROR_TITLE_LINES = 4;
const ERROR_PREFIX_MAX_CHARS = 80;
const ERROR_SUMMARY_MAX_CHARS = 140;

type ToastContentParts = {
  title: ReactNode;
  description: ReactNode | undefined;
};

function isLongErrorTitle(text: string): boolean {
  return (
    text.length > LONG_ERROR_TITLE_CHARS || text.split(/\r?\n/).length > LONG_ERROR_TITLE_LINES
  );
}

function truncateSummary(text: string): string {
  if (text.length <= ERROR_SUMMARY_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, ERROR_SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

function deriveLongErrorTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!firstLine) {
    return i18n._(msg`Error`);
  }

  const prefixMatch = firstLine.match(/^([^:\n]{1,80}):\s+/);
  if (prefixMatch?.[1]) {
    return prefixMatch[1].trim();
  }

  return truncateSummary(firstLine);
}

function deriveLongErrorDescription(text: string, title: string): string {
  if (title.length <= ERROR_PREFIX_MAX_CHARS && text.startsWith(`${title}:`)) {
    return text.slice(title.length + 1).trimStart();
  }

  return text;
}

function mergeLongErrorDescription(current: ReactNode | undefined, fallback: string): ReactNode {
  if (current === undefined) {
    return fallback;
  }
  if (typeof current !== "string" || !current.trim()) {
    return current;
  }
  if (current.includes(fallback) || fallback.includes(current)) {
    return current;
  }

  return `${current}\n\n${fallback}`;
}

function brandDisplayNode<T extends ReactNode>(node: T): T {
  return typeof node === "string" ? (brandDisplayText(node) as T) : node;
}

export function normalizeToastContent(
  variant: ReactNode,
  rawTitle: ReactNode,
  rawDescription: ReactNode | undefined,
): ToastContentParts {
  // ViscosityCode: only the rendered text changes; the queued toast content and
  // its actions (for example Copy) keep the raw text.
  const title = brandDisplayNode(rawTitle);
  const description = brandDisplayNode(rawDescription);
  if (variant !== "danger" || typeof title !== "string") {
    return { title, description };
  }

  const text = title.trim();
  if (!isLongErrorTitle(text)) {
    return { title, description };
  }

  const nextTitle = deriveLongErrorTitle(text);
  const nextDescription = deriveLongErrorDescription(text, nextTitle);
  return {
    title: nextTitle,
    description: mergeLongErrorDescription(description, nextDescription),
  };
}

export function getToastActionLabel(actionProps: any): string | undefined {
  const children = actionProps?.children;
  return typeof children === "string" ? children : undefined;
}
