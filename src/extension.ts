import * as vscode from "vscode";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import * as path from "path";
import * as os from "os";

const OUTPUT_CHANNEL_NAME = "sqlnbfmt";
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

  // Format notebook cells (each cell is a separate TextDocument)
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

  // Command: format the entire active notebook (.ipynb) at once
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

        // Save first so the file on disk matches the editor
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

          // Revert the editor to pick up the on-disk changes
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
