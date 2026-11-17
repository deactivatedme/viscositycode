import { brandText, UPSTREAM_BRAND_NAME } from "@/shared/brand";

/**
 * ViscosityCode: product-name substitution for runtime text at the display layer.
 *
 * Catalog text is branded when a catalog loads (`brandCatalog.ts`), but engine
 * and provider text (supervisor errors such as "…so Poracode will not start…",
 * runtime error items, toast text built from `error.message`) reaches the UI
 * as raw strings. Components that render it pass it through here right before
 * display. The stored or sent value is never changed, so error matching, auth
 * detection, de-duplication and copy actions keep working on the raw text.
 *
 * Only prose is branded. A whitespace-delimited token that looks like a path,
 * URL or file name (`/Users/me/Poracode/x`, `C:\Poracode\x`, `Poracode-master`,
 * `Poracode.app`) names a real location, so it is kept verbatim.
 */

const TOKEN_PATTERN = /\S+/g;

/** Path or URL separators, or the name glued to a file-name/folder-name part. */
const PATH_LIKE_PATTERN = /[/\\]|Poracode[-_.]\w|\w[-.]Poracode/;

/** {@link brandText} for runtime text shown to the user, leaving paths and URLs intact. */
export function brandDisplayText(text: string): string {
  if (!text.includes(UPSTREAM_BRAND_NAME)) return text;
  return text.replace(TOKEN_PATTERN, (token) =>
    token.includes(UPSTREAM_BRAND_NAME) && !PATH_LIKE_PATTERN.test(token)
      ? brandText(token)
      : token,
  );
}
