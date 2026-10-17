import { describe, expect, it } from "vitest";
import { assertSafeSpecTarget, SPEC_TARGET_OVERRIDE_ENV_VAR, UnsafeSpecTargetError } from "./spec-safety";

// Pure unit tests of the guard logic only — never issues a real request
// anywhere, local or remote. assertSafeSpecTarget never touches the
// network; it only parses the URL it's given.
describe("assertSafeSpecTarget", () => {
  it("allows the default local target with no override set", () => {
    expect(() => assertSafeSpecTarget("http://localhost:8080", {})).not.toThrow();
  });

  it("allows other recognized local hostnames", () => {
    expect(() => assertSafeSpecTarget("http://127.0.0.1:8080", {})).not.toThrow();
    expect(() => assertSafeSpecTarget("http://[::1]:3000", {})).not.toThrow();
    expect(() => assertSafeSpecTarget("http://0.0.0.0:8080", {})).not.toThrow();
  });

  it("is case-insensitive on the hostname", () => {
    expect(() => assertSafeSpecTarget("http://LOCALHOST:8080", {})).not.toThrow();
  });

  it("ignores port and path differences for a local hostname", () => {
    expect(() => assertSafeSpecTarget("http://localhost:4321/some/deep/path", {})).not.toThrow();
    expect(() => assertSafeSpecTarget("https://localhost", {})).not.toThrow();
  });

  it("refuses the project's real production Fly.io domain by default", () => {
    expect(() => assertSafeSpecTarget("https://comp4020-final-januaraine.fly.dev", {})).toThrow(
      UnsafeSpecTargetError,
    );
  });

  it("refuses any other non-local hostname by default", () => {
    expect(() => assertSafeSpecTarget("https://example.com", {})).toThrow(UnsafeSpecTargetError);
    expect(() => assertSafeSpecTarget("https://staging.example.com:8080/x", {})).toThrow(UnsafeSpecTargetError);
  });

  it("is not fooled by a hostname that merely contains 'localhost'", () => {
    expect(() => assertSafeSpecTarget("https://localhost.attacker.example", {})).toThrow(UnsafeSpecTargetError);
    expect(() => assertSafeSpecTarget("https://evillocalhost:8080", {})).toThrow(UnsafeSpecTargetError);
  });

  it("refuses an unparseable URL", () => {
    expect(() => assertSafeSpecTarget("not a url", {})).toThrow(UnsafeSpecTargetError);
  });

  it("allows a non-local target when the override env var is set to '1'", () => {
    expect(() =>
      assertSafeSpecTarget("https://comp4020-final-januaraine.fly.dev", { [SPEC_TARGET_OVERRIDE_ENV_VAR]: "1" }),
    ).not.toThrow();
  });

  it("does not treat any other override value as authorization", () => {
    expect(() =>
      assertSafeSpecTarget("https://comp4020-final-januaraine.fly.dev", { [SPEC_TARGET_OVERRIDE_ENV_VAR]: "true" }),
    ).toThrow(UnsafeSpecTargetError);
    expect(() =>
      assertSafeSpecTarget("https://comp4020-final-januaraine.fly.dev", { [SPEC_TARGET_OVERRIDE_ENV_VAR]: "yes" }),
    ).toThrow(UnsafeSpecTargetError);
    expect(() =>
      assertSafeSpecTarget("https://comp4020-final-januaraine.fly.dev", { [SPEC_TARGET_OVERRIDE_ENV_VAR]: "" }),
    ).toThrow(UnsafeSpecTargetError);
  });

  it("does not let the override env var rescue an unparseable URL", () => {
    expect(() => assertSafeSpecTarget("not a url", { [SPEC_TARGET_OVERRIDE_ENV_VAR]: "1" })).toThrow(
      UnsafeSpecTargetError,
    );
  });
});
