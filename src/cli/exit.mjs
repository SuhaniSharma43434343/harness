// exitWhenDone(code): ends the CLI with `code` without calling process.exit straight away.
//
// On Windows (seen with Node 24.16), process.exit right after a request to a remote host crashes
// Node in libuv ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c")
// and the process ends with 0xC0000409 instead of `code`, so a command that worked looks failed.
// Letting Node exit on its own avoids it. The fallback timer still exits if something keeps the
// process open, and is unref'd so it never delays a process that would exit anyway.
export const EXIT_GRACE_MS = 250;

export function exitWhenDone(code, { proc = process, graceMs = EXIT_GRACE_MS, schedule = setTimeout } = {}) {
  proc.exitCode = code;
  const timer = schedule(() => proc.exit(code), graceMs);
  timer?.unref?.();
  return timer;
}
