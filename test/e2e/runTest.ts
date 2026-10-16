/**
 * End-to-end tests: runs the extension in a downloaded VS Code (not your own
 * installation) against scratch workspaces, with the sqlnbfmt CLI from PATH.
 *
 *   npm run test:e2e
 *
 * Two runs: a trusted workspace (formatting, config discovery, errors) and an
 * untrusted one in Restricted Mode (the workspace can't choose the program).
 */
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { findOnPath } from "../../src/cli";

const repo = path.resolve(__dirname, "../../..");
const extensionTestsPath = path.resolve(__dirname, "suite");
const QUERY = "select a, b from t where c = 1 limit 5";

function write(file: string, content: string, mode?: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) {
    chmodSync(file, mode);
  }
}

function notebook(cells: string[]): string {
  return JSON.stringify({
    cells: cells.map((source) => ({
      cell_type: "code",
      execution_count: null,
      metadata: {},
      outputs: [],
      source,
    })),
    metadata: {
      kernelspec: { name: "python3", display_name: "Python 3", language: "python" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 4,
  });
}

function trustedWorkspace(dir: string, cli: string) {
  mkdirSync(path.join(dir, ".git"), { recursive: true }); // discovery stops here
  // A relative sqlnbfmt.path: resolved against the workspace folder, although
  // the CLI runs in the formatted file's folder. The wrapper leaves a marker.
  write(
    path.join(dir, ".vscode/settings.json"),
    JSON.stringify({ "sqlnbfmt.path": "tools/sqlnbfmt" })
  );
  write(
    path.join(dir, "tools/sqlnbfmt"),
    `#!/bin/sh\ntouch "${dir}/wrapper-used"\nexec "${cli}" "$@"\n`,
    0o755
  );
  write(path.join(dir, "root.py"), `q = "${QUERY}"\n`);
  write(path.join(dir, "tsql/pyproject.toml"), '[tool.sqlnbfmt]\ndialect = "tsql"\n');
  write(path.join(dir, "tsql/q.py"), `q = "${QUERY}"\n`);
  write(path.join(dir, "bad/pyproject.toml"), '[tool.sqlnbfmt]\ndialect = "postgress"\n');
  write(path.join(dir, "bad/q.py"), `q = "${QUERY}"\n`);
  write(
    path.join(dir, "nb.ipynb"),
    notebook(["%%sql\nselect a, b from t where c = 1", `q = "${QUERY}"`])
  );
}

function restrictedWorkspace(dir: string) {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  write(
    path.join(dir, ".vscode/settings.json"),
    JSON.stringify({ "sqlnbfmt.path": "./evil.sh" })
  );
  write(path.join(dir, "evil.sh"), `#!/bin/sh\ntouch "${dir}/evil-ran"\n`, 0o755);
  write(path.join(dir, "q.py"), `q = "${QUERY}"\n`);
}

function isFile(file: string) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const cli = findOnPath("sqlnbfmt", process.env, process.platform, isFile);
  if (!cli) {
    throw new Error("sqlnbfmt must be on PATH (pip install sqlnbfmt)");
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "sqlnbfmt-e2e-"));
  try {
    const trusted = path.join(scratch, "trusted");
    trustedWorkspace(trusted, cli);
    const vscodeExecutablePath = await downloadAndUnzipVSCode();

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: repo,
      extensionTestsPath,
      launchArgs: [trusted],
      extensionTestsEnv: { SQLNBFMT_E2E_MODE: "trusted" },
    });

    // runTests always passes --disable-workspace-trust, so launch directly
    const restricted = path.join(scratch, "restricted");
    restrictedWorkspace(restricted);
    const userData = path.join(scratch, "user-data");
    write(
      path.join(userData, "User/settings.json"),
      JSON.stringify({ "security.workspace.trust.startupPrompt": "never" })
    );
    const run = spawnSync(
      vscodeExecutablePath,
      [
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        `--user-data-dir=${userData}`,
        `--extensions-dir=${path.join(scratch, "extensions")}`,
        `--extensionDevelopmentPath=${repo}`,
        `--extensionTestsPath=${extensionTestsPath}`,
        restricted,
      ],
      {
        env: { ...process.env, SQLNBFMT_E2E_MODE: "restricted" },
        stdio: "inherit",
      }
    );
    if (run.status !== 0) {
      throw new Error(`Restricted Mode tests failed (exit ${run.status})`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
