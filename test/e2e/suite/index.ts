/**
 * Runs inside the VS Code extension host (see ../runTest.ts). A minimal
 * runner: each test is an async function; any failure fails the run.
 */
import * as assert from "assert/strict";
import { existsSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";

const FORMATTED_SQL = "SELECT\n  a,\n  b\nFROM t\nWHERE\n  c = 1";
const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

function workspaceFile(...parts: string[]): string {
  return path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, ...parts);
}

/** The text after running the document formatter (as on save). VS Code
 * returns minimal edits (a diff), not the provider's single edit. */
async function formatted(document: vscode.TextDocument): Promise<string> {
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    document.uri,
    { tabSize: 4, insertSpaces: true }
  );
  let text = document.getText();
  const byOffset = (edit: vscode.TextEdit) => document.offsetAt(edit.range.start);
  for (const edit of [...(edits ?? [])].sort((a, b) => byOffset(b) - byOffset(a))) {
    text =
      text.slice(0, document.offsetAt(edit.range.start)) +
      edit.newText +
      text.slice(document.offsetAt(edit.range.end));
  }
  return text;
}

async function openFile(...parts: string[]) {
  return vscode.workspace.openTextDocument(workspaceFile(...parts));
}

/** VS Code may cancel a request (e.g. while the editor settles); a cancelled
 * request returns nothing to the user, so try once more. */
async function retryIfCanceled<T>(request: () => Thenable<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (String(err).includes("Canceled")) {
      return await request();
    }
    throw err;
  }
}

/** Records error notifications instead of showing them. */
function captureErrors(): string[] {
  const shown: string[] = [];
  (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (
    message: string
  ) => {
    shown.push(message);
    return Promise.resolve(undefined);
  };
  return shown;
}

function trustedTests() {
  test("the workspace is trusted", async () => {
    assert.equal(vscode.workspace.isTrusted, true);
  });

  test("formats SQL in a .py file", async () => {
    const text = await formatted(await openFile("root.py"));
    assert.match(text, /SELECT\n {2}a,\n {2}b\nFROM t\nWHERE\n {2}c = 1\nLIMIT 5/);
  });

  test("uses the pyproject.toml of the file's folder", async () => {
    // [tool.sqlnbfmt] dialect = "tsql" in tsql/: LIMIT becomes TOP
    const text = await formatted(await openFile("tsql", "q.py"));
    assert.match(text, /SELECT\s+TOP 5/);
    assert.doesNotMatch(text, /LIMIT/);
  });

  test("a relative sqlnbfmt.path resolves against the workspace folder", async () => {
    assert.ok(existsSync(workspaceFile("wrapper-used")));
  });

  test("formats a %%sql notebook cell like Jupyter", async () => {
    const notebook = await vscode.workspace.openNotebookDocument(
      vscode.Uri.file(workspaceFile("nb.ipynb"))
    );
    const cell = notebook.cellAt(0).document;
    assert.equal(cell.languageId, "python");
    assert.equal(await formatted(cell), `%%sql\n${FORMATTED_SQL}`);
    const pythonCell = notebook.cellAt(1).document;
    assert.match(await formatted(pythonCell), /^q = """\nSELECT\n/);
  });

  test("the code action runs only when requested", async () => {
    // Code actions come from an open editor, as on save
    const document = await openFile("root.py");
    await vscode.window.showTextDocument(document);
    const range = new vscode.Range(0, 0, 0, 0);
    const requested = await retryIfCanceled(() =>
      vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        document.uri,
        range,
        "source.sqlnbfmt"
      )
    );
    const action = requested.find((a) => a.kind?.value === "source.sqlnbfmt");
    assert.ok(action?.edit, "requested: an edit is offered");

    const lightBulb = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      document.uri,
      range
    );
    assert.equal(
      lightBulb.filter((a) => a.kind?.value === "source.sqlnbfmt").length,
      0,
      "not requested: sqlnbfmt doesn't run"
    );
  });

  test("a config error is shown once, with the reason", async () => {
    const shown = captureErrors();
    const document = await openFile("bad", "q.py");
    assert.equal(await formatted(document), document.getText());
    assert.equal(await formatted(document), document.getText());
    assert.equal(shown.length, 1, `notifications: ${JSON.stringify(shown)}`);
    assert.match(shown[0], /Unknown dialect 'postgress'/);
  });
}

function restrictedTests() {
  test("the workspace is in Restricted Mode", async () => {
    assert.equal(vscode.workspace.isTrusted, false);
  });

  test("the workspace's sqlnbfmt.path is ignored", async () => {
    const text = await formatted(await openFile("q.py"));
    assert.match(text, /SELECT\n {2}a,/, "formatted by sqlnbfmt from PATH");
    assert.ok(!existsSync(workspaceFile("evil-ran")), "evil.sh must not run");
  });
}

export async function run(): Promise<void> {
  const mode = process.env.SQLNBFMT_E2E_MODE;
  await vscode.extensions.getExtension("flyerwolf.sqlnbfmt")!.activate();
  if (mode === "restricted") {
    restrictedTests();
  } else {
    trustedTests();
  }
  let failures = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✔ [${mode}] ${name}`);
    } catch (err) {
      failures++;
      console.log(`  ✖ [${mode}] ${name}\n    ${String(err).replace(/\n/g, "\n    ")}`);
    }
  }
  if (failures) {
    throw new Error(`${failures} of ${tests.length} end-to-end tests failed`);
  }
}
