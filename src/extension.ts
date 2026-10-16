import * as vscode from "vscode";
import { execFile } from "child_process";
import { existsSync, statSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  Settings,
  cellSource,
  cliArgs,
  failureSummary,
  findOnPath,
  notebookWithCell,
  parseLog,
  resolveExecutable,
  resolveFile,
} from "./cli";

const OUTPUT_CHANNEL_NAME = "sqlnbfmt";
const CODE_ACTION_KIND = vscode.CodeActionKind.Source.append("sqlnbfmt");
const CELL_SCHEME = "vscode-notebook-cell";

let outputChannel: vscode.OutputChannel;
// The last error shown as a notification, so formatting on every save doesn't
// repeat it; cleared after a successful run.
let lastShownError: string | undefined;

interface RunContext {
  settings: Settings;
  /** The executable, as an absolute path; undefined if not found on PATH. */
  executable: string | undefined;
  /** Where the CLI runs: pyproject.toml discovery starts here. */
  cwd: string | undefined;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function lookupCommand(command: string): string | undefined {
  return findOnPath(command, process.env, process.platform, isFile);
}

/**
 * Settings for a document, with relative paths resolved against its workspace
 * folder, and the CLI run from the document's own folder, so that the nearest
 * pyproject.toml with [tool.sqlnbfmt] is found (as when running sqlnbfmt there).
 */
function runContext(uri: vscode.Uri): RunContext {
  // In Restricted Mode, VS Code ignores the workspace's sqlnbfmt.path (see
  // restrictedConfigurations in package.json), so an untrusted folder can't
  // choose the program that runs
  const config = vscode.workspace.getConfiguration("sqlnbfmt", uri);
  const workspaceFolder = (
    vscode.workspace.getWorkspaceFolder(uri) ??
    vscode.workspace.workspaceFolders?.[0]
  )?.uri.fsPath;
  const settings = {
    path: config.get<string>("path") || "sqlnbfmt",
    dialect: config.get<string>("dialect") || "",
    configFile: resolveFile(config.get<string>("configFile") || "", workspaceFolder),
  };
  const executable = resolveExecutable(settings.path, workspaceFolder, lookupCommand);
  // A notebook cell's URI has the notebook's path
  const isOnDisk = uri.scheme === "file" || uri.scheme === CELL_SCHEME;
  const folder = isOnDisk ? path.dirname(uri.fsPath) : undefined;
  const cwd =
    folder && path.isAbsolute(folder) && existsSync(folder)
      ? folder
      : workspaceFolder;
  return { settings, executable, cwd };
}

interface RunResult {
  ok: boolean;
}

function runCli(
  args: string[],
  context: RunContext,
  timeout: number
): Promise<RunResult> {
  if (!context.executable) {
    const message =
      `sqlnbfmt not found: "${context.settings.path}" is not on PATH. ` +
      "Install it with: pip install sqlnbfmt, or set sqlnbfmt.path.";
    outputChannel.appendLine(`Error: ${message}`);
    showError(message);
    return Promise.resolve({ ok: false });
  }
  const executable = context.executable;
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { cwd: context.cwd, timeout, encoding: "utf-8" },
      (error, stdout, stderr) => {
        // The CLI logs to stdout; argparse reports usage errors on stderr
        const output = [stdout, stderr].filter(Boolean).join("\n");
        if (output.trim()) {
          outputChannel.appendLine(output.trimEnd());
        }
        if (!error) {
          lastShownError = undefined;
          reportSkipped(output);
          resolve({ ok: true });
          return;
        }
        const err = error as NodeJS.ErrnoException & { killed?: boolean };
        let message: string;
        if (err.code === "ENOENT") {
          message =
            `sqlnbfmt not found at "${executable}". ` +
            "Install it with: pip install sqlnbfmt, or set sqlnbfmt.path.";
        } else if (err.killed) {
          message = `sqlnbfmt timed out after ${timeout / 1000} s.`;
        } else {
          const exitCode = typeof err.code === "number" ? err.code : null;
          message = `sqlnbfmt failed: ${failureSummary(output, exitCode)}`;
        }
        outputChannel.appendLine(`Error: ${message}`);
        showError(message);
        resolve({ ok: false });
      }
    );
  });
}

function showError(message: string) {
  if (message === lastShownError) {
    return;
  }
  lastShownError = message;
  vscode.window
    .showErrorMessage(message, "Show Output")
    .then((choice) => choice && outputChannel.show(true));
}

/** Strings the CLI left unformatted (e.g. unsafe to rewrite) are logged as
 * warnings; mention them briefly, with details in the Output panel. */
function reportSkipped(output: string) {
  const skipped = parseLog(output).filter((e) =>
    e.message.includes("SQL formatting skipped")
  ).length;
  if (skipped > 0) {
    vscode.window.setStatusBarMessage(
      `sqlnbfmt: ${skipped} SQL string${skipped > 1 ? "s" : ""} left ` +
        "unformatted (see Output > sqlnbfmt)",
      8000
    );
  }
}

/** Formats a document's text through a temporary file; null if unchanged. */
async function formatText(document: vscode.TextDocument): Promise<string | null> {
  const text = document.getText();
  if (!text.trim()) {
    return null;
  }
  const isCell = document.uri.scheme === CELL_SCHEME;
  const context = runContext(document.uri);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sqlnbfmt-"));
  const file = path.join(dir, isCell ? "cell.ipynb" : "code.py");
  try {
    await writeFile(file, isCell ? notebookWithCell(text) : text, "utf-8");
    const result = await runCli(cliArgs(file, context.settings), context, 15000);
    if (!result.ok) {
      return null;
    }
    const written = await readFile(file, "utf-8");
    const formatted = isCell ? cellSource(written) : written;
    return formatted !== text ? formatted : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function formattingEdits(
  document: vscode.TextDocument
): Promise<vscode.TextEdit[]> {
  const original = document.getText();
  const formatted = await formatText(document);
  if (formatted === null) {
    return [];
  }
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length)
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}

/**
 * CodeActionProvider that registers sqlnbfmt as a source action.
 * This lets it run alongside other formatters (Black, Ruff) via
 * editor.codeActionsOnSave: { "source.sqlnbfmt": "explicit" }
 */
class SQLFormatCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [CODE_ACTION_KIND];

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): Promise<vscode.CodeAction[] | undefined> {
    // Only when asked for (on save, or the Source Action menu): VS Code also
    // requests code actions on every cursor move, for the light bulb
    if (!context.only?.contains(CODE_ACTION_KIND)) {
      return undefined;
    }
    const edits = await formattingEdits(document);
    if (edits.length === 0) {
      return undefined;
    }

    const action = new vscode.CodeAction(
      "Format SQL strings (sqlnbfmt)",
      CODE_ACTION_KIND
    );
    action.edit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      action.edit.replace(document.uri, edit.range, edit.newText);
    }
    return [action];
  }
}

async function formatNotebook() {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active notebook editor.");
    return;
  }

  const uri = editor.notebook.uri;
  if (uri.scheme !== "file") {
    vscode.window.showWarningMessage("Can only format notebooks saved to disk.");
    return;
  }

  await vscode.workspace.save(uri);
  const context = runContext(uri);
  const result = await runCli(cliArgs(uri.fsPath, context.settings), context, 30000);
  if (result.ok) {
    await vscode.commands.executeCommand("workbench.action.files.revert");
    vscode.window.showInformationMessage("sqlnbfmt: Notebook formatted.");
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

  // Check that sqlnbfmt is available, without delaying activation
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const check: RunContext = folder
    ? runContext(folder)
    : {
        settings: { path: "sqlnbfmt", dialect: "", configFile: "" },
        executable: lookupCommand("sqlnbfmt"),
        cwd: undefined,
      };
  void runCli(["--help"], check, 10000);

  const selectors: vscode.DocumentSelector[] = [
    { scheme: "file", language: "python" },
    { scheme: CELL_SCHEME, language: "python" },
  ];
  for (const selector of selectors) {
    // As the formatter, for standalone use
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: formattingEdits,
      })
    );
    // As a code action, for use alongside Black/Ruff
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        selector,
        new SQLFormatCodeActionProvider(),
        {
          providedCodeActionKinds: SQLFormatCodeActionProvider.providedCodeActionKinds,
        }
      )
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("sqlnbfmt.formatNotebook", formatNotebook)
  );

  outputChannel.appendLine("sqlnbfmt extension activated.");
}

export function deactivate() {
  // nothing to clean up
}
