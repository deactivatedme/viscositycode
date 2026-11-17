import { setupI18n, type Messages } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { BRAND_NAME } from "@/shared/brand";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/shared/locale";
import { brandCatalogMessages, brandCatalogText, loadBrandedCatalog } from "./brandCatalog";
import { SHARED_MESSAGE_DESCRIPTORS } from "./sharedMessages";

const UPSTREAM_NAME = /\bPoracode/u;

/** Same dynamic `.po` import the runtime uses (`dynamicActivate`), compiled by the Lingui Vite plugin. */
async function loadCatalog(locale: SupportedLocale): Promise<Messages> {
  const module = (await import(`../locales/${locale}/messages.po`)) as { messages: Messages };
  return module.messages;
}

/** Every piece of literal text in a catalog value (not argument names, types, or styles). */
function literalTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const token of value) {
      if (typeof token === "string") out.push(token);
      else if (Array.isArray(token)) {
        const format: unknown = token[2];
        if (format && typeof format === "object" && !Array.isArray(format)) {
          for (const choice of Object.values(format)) literalTexts(choice, out);
        }
      }
    }
  }
  return out;
}

/** The catalog value with literal text blanked, so only its structure remains. */
function structure(value: unknown): unknown {
  if (typeof value === "string") return "";
  if (!Array.isArray(value)) return value;
  return value.map((token: unknown) => {
    if (typeof token === "string") return "";
    if (!Array.isArray(token)) return token;
    const [name, type, format] = token as [unknown, unknown, unknown];
    if (format && typeof format === "object" && !Array.isArray(format)) {
      return [
        name,
        type,
        Object.fromEntries(
          Object.entries(format).map(([key, choice]) => [
            key,
            Array.isArray(choice) ? structure(choice) : choice,
          ]),
        ),
      ];
    }
    return token;
  });
}

describe("branded Lingui catalogs", () => {
  it.each(SUPPORTED_LOCALES)(
    "leaves no upstream product name in the %s catalog",
    async (locale) => {
      const messages = await loadCatalog(locale);
      const branded = brandCatalogMessages(messages);

      expect(Object.keys(branded)).toEqual(Object.keys(messages));
      const leftovers = Object.entries(branded).filter(([, value]) =>
        literalTexts(value).some((text) => UPSTREAM_NAME.test(text)),
      );
      expect(leftovers).toEqual([]);
      // Placeholders, formatter types, styles and plural/select choices are untouched.
      for (const [id, value] of Object.entries(messages)) {
        // The id rides along so a failure names the message.
        expect({ id, structure: structure(branded[id]) }).toEqual({
          id,
          structure: structure(value),
        });
      }
    },
  );

  it("actually substitutes the name in every catalog that mentions it", async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const branded = brandCatalogMessages(await loadCatalog(locale));
      const texts = Object.values(branded).flatMap((value) => literalTexts(value));
      expect({ locale, branded: texts.some((text) => text.includes(BRAND_NAME)) }).toEqual({
        locale,
        branded: true,
      });
    }
  });

  it.each(["en", "de", "es", "ja"] as const)(
    "renders placeholder messages with their values in %s",
    async (locale) => {
      const i18n = setupI18n();
      loadBrandedCatalog(locale, await loadCatalog(locale), i18n);
      i18n.activate(locale);

      const auth = i18n._(SHARED_MESSAGE_DESCRIPTORS["acp.authenticationUnverified"].id!, {
        agent: "Agent Poracode Fixture",
      });
      // The value is interpolated verbatim (values are never branded)...
      expect(auth).toContain("Agent Poracode Fixture");
      expect(auth).not.toContain("{agent}");
      // ...while the catalog's own text names the fork.
      expect(auth.replaceAll("Agent Poracode Fixture", "")).not.toMatch(UPSTREAM_NAME);
      expect(auth).toContain(BRAND_NAME);

      const startup = i18n._(SHARED_MESSAGE_DESCRIPTORS["startup.failure.body"].id!, {
        detail: "C:\\Poracode\\data is locked",
      });
      expect(startup).toContain("C:\\Poracode\\data is locked");
      expect(startup).not.toContain("{detail}");
      expect(startup).toContain(BRAND_NAME);
    },
  );

  it("keeps plural and select structure while branding their branches", () => {
    const i18n = setupI18n();
    const messages: Messages = {
      threads: [
        "Poracode has ",
        [
          "count",
          "plural",
          { offset: undefined, one: ["#", " Poracode thread"], other: ["#", " Poracode threads"] },
        ],
      ],
      mode: [["kind", "select", { offset: undefined, app: ["Open Poracode"], other: ["Open"] }]],
      plain: "Restart Poracode",
    };
    loadBrandedCatalog("en", messages, i18n);
    i18n.activate("en");

    expect(i18n._("threads", { count: 1 })).toBe(`${BRAND_NAME} has 1 ${BRAND_NAME} thread`);
    expect(i18n._("threads", { count: 3 })).toBe(`${BRAND_NAME} has 3 ${BRAND_NAME} threads`);
    expect(i18n._("mode", { kind: "app" })).toBe(`Open ${BRAND_NAME}`);
    expect(i18n._("mode", { kind: "web" })).toBe("Open");
    expect(i18n._("plain")).toBe(`Restart ${BRAND_NAME}`);
    // The input catalog is not mutated.
    expect(messages.plain).toBe("Restart Poracode");
  });

  it("keeps message identity when there is nothing to brand", () => {
    const untouched: Messages[string] = ["Hello ", ["name"], "!"];
    const branded = brandCatalogMessages({ greeting: untouched });
    expect(branded.greeting).toBe(untouched);
  });

  it("brands inflected and possessive forms but not identifiers", () => {
    expect(brandCatalogText("mit Poracodes nativen Laufzeiten")).toBe(
      `mit ${BRAND_NAME}s nativen Laufzeiten`,
    );
    expect(brandCatalogText("Poracode's read_thread tool")).toBe(
      `${BRAND_NAME}'s read_thread tool`,
    );
    expect(brandCatalogText(".poracode/worktrees and PORACODE_HOME")).toBe(
      ".poracode/worktrees and PORACODE_HOME",
    );
  });
});
