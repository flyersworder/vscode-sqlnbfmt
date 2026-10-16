/**
 * Helpers for running the sqlnbfmt CLI that don't depend on VS Code, so they
 * can be tested with plain Node (see test/cli.test.ts).
 */
import * as path from "path";

export interface Settings {
  path: string;
  dialect: string;
  configFile: string;
}

/** Replaces `${workspaceFolder}` in a setting, as VS Code users write paths. */
function expandVariables(value: string, workspaceFolder: string | undefined) {
  return workspaceFolder
    ? value.split("${workspaceFolder}").join(workspaceFolder)
    : value;
}

/**
 * The executable to run. A bare command ("sqlnbfmt") is looked up on PATH;
 * a relative path (".venv/bin/sqlnbfmt") is relative to the workspace folder,
 * not to the folder the CLI runs in.
 */
export function resolveExecutable(
  value: string,
  workspaceFolder: string | undefined
): string {
  const expanded = expandVariables(value, workspaceFolder);
  const isBareCommand = !expanded.includes("/") && !expanded.includes("\\");
  if (isBareCommand || path.isAbsolute(expanded) || !workspaceFolder) {
    return expanded;
  }
  return path.resolve(workspaceFolder, expanded);
}

/** A file setting (configFile), relative to the workspace folder. */
export function resolveFile(
  value: string,
  workspaceFolder: string | undefined
): string {
  const expanded = expandVariables(value, workspaceFolder);
  if (!expanded || path.isAbsolute(expanded) || !workspaceFolder) {
    return expanded;
  }
  return path.resolve(workspaceFolder, expanded);
}

/** Arguments for formatting ``file`` in place. */
export function cliArgs(file: string, settings: Settings): string[] {
  const args = [file, "--log-level", "WARNING"];
  if (settings.dialect) {
    args.push("--dialect", settings.dialect);
  }
  if (settings.configFile) {
    args.push("--config", settings.configFile);
  }
  return args;
}

/**
 * A notebook holding one code cell. Cells are formatted as notebooks, not as
 * .py files, so that %%sql magics and "# sqlnbfmt: skip" work per cell, as in
 * Jupyter.
 */
export function notebookWithCell(source: string): string {
  return JSON.stringify({
    cells: [
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source,
      },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 4,
  });
}

/** The source of the first cell of a notebook written by the CLI. */
export function cellSource(notebookJson: string): string {
  const source = JSON.parse(notebookJson).cells[0].source;
  return Array.isArray(source) ? source.join("") : source;
}

export interface LogEntry {
  level: string;
  message: string;
}

/**
 * The CLI's log records ("[WARNING] message", on stdout); lines without a
 * level prefix continue the previous record. Text before the first record
 * (e.g. argparse's usage errors, on stderr) becomes an ERROR record.
 */
export function parseLog(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[(DEBUG|INFO|WARNING|ERROR|CRITICAL)\] (.*)$/.exec(line);
    if (match) {
      entries.push({ level: match[1], message: match[2] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].message += `\n${line}`;
    } else if (line.trim()) {
      entries.push({ level: "ERROR", message: line });
    }
  }
  for (const entry of entries) {
    entry.message = entry.message.trimEnd();
  }
  return entries;
}

/** A one-line summary of why the CLI failed, for a notification. */
export function failureSummary(output: string, exitCode: number | null): string {
  const entries = parseLog(output);
  const errors = entries.filter(
    (e) => e.level === "ERROR" || e.level === "CRITICAL"
  );
  const last = (errors.length ? errors : entries).pop();
  const message = last?.message.split("\n").filter((l) => l.trim()).pop();
  return message ?? `sqlnbfmt exited with code ${exitCode}`;
}
