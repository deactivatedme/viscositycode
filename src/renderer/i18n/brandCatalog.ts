import { i18n as defaultI18n, type I18n, type Messages } from "@lingui/core";
import { BRAND_NAME, brandText } from "@/shared/brand";

/**
 * ViscosityCode: product-name substitution for Lingui catalogs.
 *
 * The `.po` catalogs stay byte-identical to upstream (no merge conflicts, one
 * translation pass), and every catalog is branded here as it loads instead.
 *
 * A compiled catalog maps message ids to either an uncompiled string or a
 * compiled token list (`CompiledMessage` from `@lingui/message-utils`):
 *
 * - a string token is literal text;
 * - an array token is an argument `[name, type?, format?]`, where `format` is
 *   a choices map (`plural`, `select`, `selectordinal`) whose values are nested
 *   token lists plus a numeric `offset`, or a style string for `number`/`date`.
 *
 * Only literal text is rewritten. Argument names, formatter types, style
 * strings, choice keys and offsets stay untouched, so placeholders keep
 * resolving, and interpolated values (user paths, agent names) are never
 * rewritten because they are not part of the catalog.
 */

type Token = string | readonly unknown[];

/** Inflected upstream name in translations (German genitive "Poracodes"). */
const UPSTREAM_GENITIVE_PATTERN = /\bPoracodes\b/g;

/** {@link brandText} plus the inflected forms translations use. */
export function brandCatalogText(text: string): string {
  const branded = brandText(text);
  return branded.includes("Poracodes")
    ? branded.replace(UPSTREAM_GENITIVE_PATTERN, `${BRAND_NAME}s`)
    : branded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Brand the literal text of a token list; returns the same array when nothing changed. */
function brandTokens(tokens: readonly unknown[]): readonly unknown[] {
  let changed = false;
  const next = tokens.map((token) => {
    const branded = brandToken(token as Token);
    if (branded !== token) changed = true;
    return branded;
  });
  return changed ? next : tokens;
}

function brandToken(token: Token): Token {
  if (typeof token === "string") return brandCatalogText(token);
  if (!Array.isArray(token)) return token;
  // Argument token: only a choices map (plural/select) carries nested text.
  const format: unknown = token[2];
  if (!isPlainObject(format)) return token;
  const choices = brandChoices(format);
  if (choices === format) return token;
  const next = [...token];
  next[2] = choices;
  return next;
}

function brandChoices(choices: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(choices)) {
    // `offset` (and any other non-message field) is copied as-is.
    const branded =
      typeof value === "string"
        ? brandCatalogText(value)
        : Array.isArray(value)
          ? brandTokens(value)
          : value;
    if (branded !== value) changed = true;
    next[key] = branded;
  }
  return changed ? next : choices;
}

/** Brand one catalog value (uncompiled string or compiled token list). */
export function brandCatalogMessage<T>(value: T): T {
  if (typeof value === "string") return brandCatalogText(value) as T;
  if (Array.isArray(value)) return brandTokens(value) as T;
  return value;
}

/** Brand every message of a compiled catalog. Values that need no change keep their identity. */
export function brandCatalogMessages(messages: Messages): Messages {
  const branded: Messages = {};
  for (const [id, value] of Object.entries(messages)) {
    branded[id] = brandCatalogMessage(value);
  }
  return branded;
}

/** `i18n.load` for a locale catalog, with the product name branded first. */
export function loadBrandedCatalog(
  locale: string,
  messages: Messages,
  target: I18n = defaultI18n,
): void {
  target.load(locale, brandCatalogMessages(messages));
}
