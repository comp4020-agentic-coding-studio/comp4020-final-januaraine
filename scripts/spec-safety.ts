// Guards spec/global-setup.ts's one entry point for where every
// spec/*.test.ts file sends its HTTP traffic. Those tests create rooms,
// join players, and otherwise mutate whatever APP_URL points at — safe
// against a disposable local/CI instance, destructive against a real
// deployment. Default-deny: only a small, exactly-matched set of local
// hostnames is allowed without an explicit override, so a stray or
// mistaken APP_URL (production, staging, someone else's deployment) is
// refused rather than silently tested against.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export const SPEC_TARGET_OVERRIDE_ENV_VAR = "COMP4020_ALLOW_REMOTE_SPEC";

export class UnsafeSpecTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSpecTargetError";
  }
}

// `env` is injectable (defaults to the real process.env) so this stays a
// pure function callable from a unit test with no process-global mutation
// and no network access at all.
export function assertSafeSpecTarget(rawUrl: string, env: Record<string, string | undefined> = process.env): void {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    throw new UnsafeSpecTargetError(`APP_URL "${rawUrl}" is not a valid URL — refusing to run spec/*.test.ts against it.`);
  }

  if (LOCAL_HOSTNAMES.has(hostname)) return;

  if (env[SPEC_TARGET_OVERRIDE_ENV_VAR] === "1") {
    console.warn(
      "\n" +
        "⚠️  ⚠️  ⚠️  RUNNING INTEGRATION TESTS AGAINST A NON-LOCAL TARGET  ⚠️  ⚠️  ⚠️\n" +
        `⚠️  APP_URL = ${rawUrl}\n` +
        `⚠️  ${SPEC_TARGET_OVERRIDE_ENV_VAR}=1 was set explicitly, so this run is allowed to proceed.\n` +
        "⚠️  spec/*.test.ts creates rooms, joins players, and otherwise writes to\n" +
        "⚠️  whatever this URL points at. If that's a real deployment, its state\n" +
        "⚠️  (room list, metrics, etc.) will change as a result of this run.\n",
    );
    return;
  }

  throw new UnsafeSpecTargetError(
    `Refusing to run spec/*.test.ts against "${rawUrl}" (hostname "${hostname}") — this is not a recognized ` +
      "local test target, and these tests create rooms, join players, and otherwise mutate whatever APP_URL " +
      "points at. If this really is a disposable, non-production target you mean to test against, re-run with " +
      `${SPEC_TARGET_OVERRIDE_ENV_VAR}=1 set explicitly.`,
  );
}
