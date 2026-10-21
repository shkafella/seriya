import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const requestedArgs = process.argv.slice(2);
if (requestedArgs.length === 0) {
  throw new Error("Pass Python arguments after scripts/run-python.mjs");
}

const candidates = [
  process.env.SERIYA_PYTHON
    ? { command: process.env.SERIYA_PYTHON, prefix: [] }
    : null,
  { command: "python", prefix: [] },
  { command: "python3", prefix: [] },
  { command: "py", prefix: ["-3"] },
  {
    command: join(
      homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "python.exe",
    ),
    prefix: [],
  },
].filter(Boolean);

let selected;
for (const candidate of candidates) {
  const probe = spawnSync(
    candidate.command,
    [...candidate.prefix, "--version"],
    { encoding: "utf8", windowsHide: true },
  );
  if (!probe.error && probe.status === 0) {
    selected = candidate;
    break;
  }
}

if (!selected) {
  throw new Error(
    "Python 3 was not found. Install it or set SERIYA_PYTHON to the executable path.",
  );
}

const result = spawnSync(
  selected.command,
  [...selected.prefix, "-B", ...requestedArgs],
  { stdio: "inherit", windowsHide: true },
);
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
