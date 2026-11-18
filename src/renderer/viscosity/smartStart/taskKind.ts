/**
 * ViscosityCode: Smart start task kind (fork of Poracode).
 *
 * A small, deterministic guess at what a new-thread prompt is: coding work
 * ("fix the failing test in parser.ts") or a quick question ("what does
 * this flag do?"). It only nudges which provider Smart start prefers, so it
 * stays cheap (one pass over at most the first few thousand characters) and
 * never knows a provider by name. `undefined` means "can't tell": an empty
 * prompt, or a long prompt with no signal either way.
 */
import type { PromptSegment } from "@/shared/contracts";

export type SmartStartTaskKind = "coding" | "quick";

export const SMART_START_TASK_KINDS: readonly SmartStartTaskKind[] = ["coding", "quick"];

/** Only the start of a prompt is read; that is where intent shows. */
const MAX_CLASSIFIED_CHARS = 4000;
/** Questions longer than this read as a task description rather than a quick question. */
const QUICK_MAX_CHARS = 200;

const CODE_FENCE = /```/;
const FILE_PATH =
  /(?:^|[\s(`'"])(?:[\w.-]+\/)*[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sql|json|ya?ml|toml|css|scss|html|vue|svelte|sh)\b/i;
const CODE_TOKENS =
  /=>|\(\)|::|[{};]\s*$|\b(?:const|let|function|def|import|return|async|await)\s/m;
const CODING_WORDS =
  /\b(?:implement|refactor|fix|bug|debug|tests?|compile|build|lint|typecheck|stack ?trace|exception|crash|function|method|class|module|endpoint|api|migrat(?:e|ion)|deploy|commit|branch|merge|pull request|repo|code ?base|code|component|regression|rename|script|feature)\b/gi;
const QUESTION_START =
  /^(?:what|what's|whats|why|how|when|where|who|which|is|are|can|could|should|would|does|do|did|explain|tell me)\b/i;

export interface TaskKindInput {
  text: string;
  /** The prompt references files, diffs or other code context (mention segments). */
  hasCodeContext?: boolean;
}

/** Signal strengths: a code fence or a file path outweighs any wording. */
function codingSignals(text: string, hasCodeContext: boolean): number {
  let score = hasCodeContext ? 3 : 0;
  if (CODE_FENCE.test(text)) score += 3;
  if (FILE_PATH.test(text)) score += 2;
  if (CODE_TOKENS.test(text)) score += 2;
  const words = text.match(CODING_WORDS)?.length ?? 0;
  return score + Math.min(words, 2);
}

function quickSignals(text: string): number {
  let score = 0;
  if (text.endsWith("?")) score += 2;
  if (QUESTION_START.test(text)) score += 1;
  if (text.length <= QUICK_MAX_CHARS) score += 1;
  return score;
}

/** Classify a prompt; `undefined` when it is empty or gives no signal. */
export function classifyTaskKind(input: TaskKindInput): SmartStartTaskKind | undefined {
  const text = input.text.slice(0, MAX_CLASSIFIED_CHARS).trim();
  const hasCodeContext = input.hasCodeContext === true;
  if (!text && !hasCodeContext) return undefined;
  const coding = codingSignals(text, hasCodeContext);
  const quick = quickSignals(text);
  if (coding >= 2 && coding >= quick) return "coding";
  if (quick >= 3) return "quick";
  if (coding >= 1) return "coding";
  if (quick >= 1 && text.length <= QUICK_MAX_CHARS) return "quick";
  return undefined;
}

const CODE_CONTEXT_SEGMENTS: ReadonlySet<PromptSegment["kind"]> = new Set(["file", "diff_comment"]);

/** The composer's segments as classifier input: text joined, file/diff mentions as code context. */
export function taskKindInputFromSegments(segments: readonly PromptSegment[]): TaskKindInput {
  let text = "";
  let hasCodeContext = false;
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (text.length < MAX_CLASSIFIED_CHARS) text += segment.content;
    } else if (CODE_CONTEXT_SEGMENTS.has(segment.kind)) {
      hasCodeContext = true;
    }
  }
  return { text, hasCodeContext };
}
