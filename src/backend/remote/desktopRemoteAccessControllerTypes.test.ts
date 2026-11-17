// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  PRODUCTION_HOSTED_APP_URLS,
  PRODUCTION_PAIRING_APP_URL,
} from "./desktopRemoteAccessControllerTypes";

// ViscosityCode: pairing never points at, or trusts, Poracode's hosted web app.
describe("desktop remote access hosted app defaults", () => {
  it("has no hosted pairing app for any channel", () => {
    expect(PRODUCTION_PAIRING_APP_URL).toEqual({ stable: undefined, nightly: undefined });
  });

  it("trusts no hosted web-app origin for CORS", () => {
    expect(PRODUCTION_HOSTED_APP_URLS).toEqual([]);
  });
});
