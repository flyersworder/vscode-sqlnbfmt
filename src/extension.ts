import * as vscode from "vscode";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import * as path from "path";
import * as os from "os";

const OUTPUT_CHANNEL_NAME = "sqlnbfmt";
const CODE_ACTION_KIND = vscode.CodeActionKind.Source.append("sqlnbfmt");

let outputChannel: vscode.OutputChannel;

function getConfig() {
  const config = vscode.workspace.getConfiguration("sqlnbfmt");
  return {
    path: config.get<string>("path") || "sqlnbfmt",
    dialect: config.get<string>("dialect") || "",
    configFile: config.get<string>("configFile") || "",
  };
}

function formatCode(text: string, ext: string): string | null {
  if (!text.trim()) {
    return null;
  }

  const config = getConfig();
  const tmpFile = path.join(
    os.tmpdir(),
    `sqlnbfmt-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
  );

  try {
    writeFileSync(tmpFile, text, "utf-8");

    const args = [tmpFile];
    if (config.dialect) {
      args.push("--dialect", config.dialect);
    }
    if (config.configFile) {
      args.push("--config", config.configFile);
    }

    execFileSync(config.path, args, {
      encoding: "utf-8",
      timeout: 15000,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });

    const formatted = readFileSync(tmpFile, "utf-8");
    return formatted !== text ? formatted : null;
  } catch (err: unknown) {
    const error = err as Error & { stderr?: Buffer | string };
    outputChannel.appendLine(`Error: ${error.message}`);
    if (error.stderr) {
      outputChannel.appendLine(error.stderr.toString());
    }
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function createFormattingEdits(
  document: vscode.TextDocument,
  ext: string
): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = formatCode(original, ext);
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

  provideCodeActions(
    document: vscode.TextDocument
  ): vscode.CodeAction[] | undefined {
    const edits = createFormattingEdits(document, ".py");
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

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);

  // Check if sqlnbfmt is available
  const config = getConfig();
  try {
    execFileSync(config.path, ["--help"], { timeout: 5000 });
  } catch {
    vscode.window.showWarningMessage(
      `sqlnbfmt not found at "${config.path}". Install with: pip install sqlnbfmt`
    );
  }

  // --- Formatter registration (for standalone use) ---

  // Format .py files on disk
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { scheme: "file", language: "python" },
      {
        provideDocumentFormattingEdits(
          document: vscode.TextDocument
        ): vscode.TextEdit[] {
          return createFormattingEdits(document, ".py");
        },
      }
    )
  );

  // Format notebook cells
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { scheme: "vscode-notebook-cell", language: "python" },
      {
        provideDocumentFormattingEdits(
          document: vscode.TextDocument
        ): vscode.TextEdit[] {
          return createFormattingEdits(document, ".py");
        },
      }
    )
  );

  // --- Code Action registration (for use alongside Black/Ruff) ---

  // .py files on disk
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", language: "python" },
      new SQLFormatCodeActionProvider(),
      { providedCodeActionKinds: SQLFormatCodeActionProvider.providedCodeActionKinds }
    )
  );

  // Notebook cells
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "vscode-notebook-cell", language: "python" },
      new SQLFormatCodeActionProvider(),
      { providedCodeActionKinds: SQLFormatCodeActionProvider.providedCodeActionKinds }
    )
  );

  // --- Command: format entire notebook ---

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sqlnbfmt.formatNotebook",
      async () => {
        const editor = vscode.window.activeNotebookEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active notebook editor.");
          return;
        }

        const uri = editor.notebook.uri;
        if (uri.scheme !== "file") {
          vscode.window.showWarningMessage(
            "Can only format notebooks saved to disk."
          );
          return;
        }

        await vscode.workspace.save(uri);

        const filePath = uri.fsPath;
        const cfg = getConfig();
        const args = [filePath];
        if (cfg.dialect) {
          args.push("--dialect", cfg.dialect);
        }
        if (cfg.configFile) {
          args.push("--config", cfg.configFile);
        }

        try {
          execFileSync(cfg.path, args, {
            encoding: "utf-8",
            timeout: 30000,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          });

          await vscode.commands.executeCommand(
            "workbench.action.files.revert"
          );
          vscode.window.showInformationMessage(
            "sqlnbfmt: Notebook formatted."
          );
        } catch (err: unknown) {
          const error = err as Error & { stderr?: Buffer | string };
          outputChannel.appendLine(`Error: ${error.message}`);
          if (error.stderr) {
            outputChannel.appendLine(error.stderr.toString());
          }
          vscode.window.showErrorMessage(
            "sqlnbfmt formatting failed. See Output panel for details."
          );
        }
      }
    )
  );

  outputChannel.appendLine("sqlnbfmt extension activated.");
}

export function deactivate() {
  // nothing to clean up
}
