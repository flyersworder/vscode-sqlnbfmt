import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import {
  cellSource,
  cliArgs,
  failureSummary,
  findOnPath,
  notebookWithCell,
  parseLog,
  resolveExecutable,
  resolveFile,
} from "../src/cli";

const ws = path.resolve("/work/project");

const lookup = (command: string) =>
  command === "sqlnbfmt" ? "/usr/local/bin/sqlnbfmt" : undefined;

test("bare command names are looked up on PATH", () => {
  assert.equal(resolveExecutable("sqlnbfmt", ws, lookup), "/usr/local/bin/sqlnbfmt");
  assert.equal(resolveExecutable("missing", ws, lookup), undefined);
});

test("relative executable paths resolve against the workspace folder", () => {
  assert.equal(
    resolveExecutable(".venv/bin/sqlnbfmt", ws, lookup),
    path.join(ws, ".venv/bin/sqlnbfmt")
  );
  assert.equal(
    resolveExecutable("${workspaceFolder}/.venv/bin/sqlnbfmt", ws, lookup),
    path.join(ws, ".venv/bin/sqlnbfmt")
  );
  assert.equal(
    resolveExecutable("/usr/bin/sqlnbfmt", ws, lookup),
    "/usr/bin/sqlnbfmt"
  );
});

test("findOnPath searches only absolute PATH entries", () => {
  const files = new Set(["/opt/bin/sqlnbfmt", "./sqlnbfmt", "sqlnbfmt"]);
  const isFile = (file: string) => files.has(file);
  // "" and "." mean the current folder, where an opened repo's files are
  assert.equal(
    findOnPath("sqlnbfmt", { PATH: ":.:/opt/bin" }, "linux", isFile),
    "/opt/bin/sqlnbfmt"
  );
  assert.equal(findOnPath("sqlnbfmt", { PATH: ":." }, "linux", isFile), undefined);
});

test("findOnPath finds .exe files on Windows", () => {
  const files = new Set(["C:\\Python\\Scripts\\sqlnbfmt.exe", "sqlnbfmt.exe"]);
  const isFile = (file: string) => files.has(file);
  assert.equal(
    findOnPath("sqlnbfmt", { Path: ".;C:\\Python\\Scripts" }, "win32", isFile),
    "C:\\Python\\Scripts\\sqlnbfmt.exe"
  );
});

test("config files resolve against the workspace folder", () => {
  assert.equal(resolveFile("config.yaml", ws), path.join(ws, "config.yaml"));
  assert.equal(resolveFile("", ws), "");
  assert.equal(resolveFile("conf/sql.yaml", undefined), "conf/sql.yaml");
});

test("cliArgs passes only the settings that are set", () => {
  assert.deepEqual(
    cliArgs("f.py", { path: "sqlnbfmt", dialect: "", configFile: "" }),
    ["f.py", "--log-level", "WARNING"]
  );
  assert.deepEqual(
    cliArgs("f.py", { path: "x", dialect: "postgres", configFile: "/c.yaml" }),
    ["f.py", "--log-level", "WARNING", "--dialect", "postgres", "--config", "/c.yaml"]
  );
});

test("cell source survives the notebook round trip", () => {
  const source = "%%sql\nselect 1\n";
  assert.equal(cellSource(notebookWithCell(source)), source);
  const written = JSON.stringify({ cells: [{ source: ["a\n", "b"] }] });
  assert.equal(cellSource(written), "a\nb");
});

test("parseLog splits records and joins continuation lines", () => {
  const stderr =
    "[WARNING] line 2: SQL formatting skipped: x\n" +
    "[WARNING] Failed to parse cell:\nfoo(\n" +
    "[ERROR] boom\n";
  assert.deepEqual(parseLog(stderr), [
    { level: "WARNING", message: "line 2: SQL formatting skipped: x" },
    { level: "WARNING", message: "Failed to parse cell:\nfoo(" },
    { level: "ERROR", message: "boom" },
  ]);
});

test("failureSummary prefers error records", () => {
  assert.equal(
    failureSummary(
      "[WARNING] meh\n[ERROR] Invalid configuration in /p/pyproject.toml: bad\n",
      1
    ),
    "Invalid configuration in /p/pyproject.toml: bad"
  );
});

test("failureSummary handles argparse errors and empty output", () => {
  const usage =
    "usage: sqlnbfmt [-h] [--config CONFIG]\n" +
    "sqlnbfmt: error: argument --dialect: Unknown dialect 'postgress'\n";
  assert.equal(
    failureSummary(usage, 2),
    "sqlnbfmt: error: argument --dialect: Unknown dialect 'postgress'"
  );
  assert.equal(failureSummary("", 3), "sqlnbfmt exited with code 3");
});

// Runs the real CLI when it's installed (CI installs it)
const cli = spawnSync("sqlnbfmt", ["--help"]).status === 0 ? "sqlnbfmt" : null;

test("the CLI formats a %%sql cell written as a notebook", { skip: !cli }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sqlnbfmt-test-"));
  try {
    const file = path.join(dir, "cell.ipynb");
    writeFileSync(file, notebookWithCell("%%sql\nselect a, b from t where c = 1"));
    execFileSync(cli!, cliArgs(file, { path: cli!, dialect: "", configFile: "" }), {
      cwd: dir,
    });
    assert.equal(
      cellSource(readFileSync(file, "utf-8")),
      "%%sql\nSELECT\n  a,\n  b\nFROM t\nWHERE\n  c = 1"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a config error from the CLI gives a useful summary", { skip: !cli }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sqlnbfmt-test-"));
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), '[tool.sqlnbfmt]\ndialect = "postgress"\n');
    writeFileSync(path.join(dir, "x.py"), 'q = "select a from t where b = 1"\n');
    const run = spawnSync(cli!, cliArgs("x.py", { path: cli!, dialect: "", configFile: "" }), {
      cwd: dir,
      encoding: "utf-8",
    });
    assert.equal(run.status, 1);
    assert.match(
      failureSummary(run.stdout + run.stderr, run.status),
      /Invalid configuration in .*pyproject\.toml: Unknown dialect 'postgress'/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
