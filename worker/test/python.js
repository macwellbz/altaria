// The repo's Python, for checking the JavaScript port against search.py and ai.py. It's the venv's (.venv at the
// repo root, or PYTHON=...); without one, the parity tests skip and say so.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const ROOT = new URL("../../", import.meta.url).pathname;
const PY = [process.env.PYTHON, `${ROOT}.venv/bin/python`].find((p) => p && existsSync(p));
export const noPython = !PY && "no Python venv: run from a checkout with .venv, or set PYTHON";

// Runs code with the repo's modules importable and `arg` holding the JSON input, and answers what it prints as JSON.
export function py(code, input = null) {
  const r = spawnSync(PY, ["-c", `import json, sys\narg = json.load(sys.stdin)\n${code}`], { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" });
  if (r.status) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
