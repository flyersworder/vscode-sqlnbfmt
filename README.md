# sqlnbfmt — SQL Notebook Formatter

Format SQL queries in Jupyter notebooks and Python files directly from VS Code. Works alongside Black, Ruff, or any other Python formatter.

## Features

- **Works with Black/Ruff** — runs as a Code Action on save, so your Python formatter stays untouched
- **Format on Save** — automatically formats SQL in `.ipynb` notebook cells and `.py` files
- **Format Notebook** — command to format all SQL in an entire notebook at once
- **Jupyter + Marimo** — works with `.ipynb` notebooks and Marimo `.py` notebooks
- **Smart Detection** — finds SQL in Python strings, `%%sql` magic cells, `mo.sql()` calls, and f-strings
- **Uses your project's configuration** — picks up `[tool.sqlnbfmt]` from the nearest `pyproject.toml`, like the `sqlnbfmt` command and its pre-commit hook

## Prerequisites

Install the `sqlnbfmt` CLI tool (0.6.0 or later recommended):

```bash
pip install sqlnbfmt
```

If it's installed in a virtual environment that isn't on your `PATH`, point the extension to it, e.g. `"sqlnbfmt.path": "${workspaceFolder}/.venv/bin/sqlnbfmt"`.

## Usage

### Recommended: Use alongside Black/Ruff

Keep your existing Python formatter and add sqlnbfmt as a Code Action on save. Ruff/Black formats your Python, sqlnbfmt formats your SQL strings — both run on every save.

```json
{
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.sqlnbfmt": "explicit"
    }
  }
}
```

### Standalone: Use as the only formatter

If you don't use another Python formatter, set sqlnbfmt as the default:

```json
{
  "[python]": {
    "editor.defaultFormatter": "flyerwolf.sqlnbfmt",
    "editor.formatOnSave": true
  },
  "notebook.formatOnSave.enabled": true
}
```

### Format Notebook Command

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

> **sqlnbfmt: Format SQL in Notebook**

This formats all SQL across every cell in the active notebook.

### Format a Cell

Right-click in a notebook cell and select **Format Cell**, or use the keyboard shortcut (`Shift+Alt+F`). Cells are formatted the way Jupyter does it: a `%%sql` cell is formatted as SQL, and `# sqlnbfmt: skip` skips just that cell.

## Configuration

sqlnbfmt's own options (dialect, which functions contain SQL, indentation) go in your project's `pyproject.toml`, so the extension, the command line and the pre-commit hook all format the same way:

```toml
[tool.sqlnbfmt]
dialect = "postgres"
extend_function_names = ["run_query"]  # recognized in addition to the defaults

[tool.sqlnbfmt.formatting_options]
indent_width = 2
```

The extension runs `sqlnbfmt` from the folder of the file being formatted, so the nearest `pyproject.toml` with a `[tool.sqlnbfmt]` table is used, searching up to the repository root. In a monorepo, each project can have its own settings. See the [sqlnbfmt documentation](https://github.com/flyersworder/sqlnbfmt#configuration) for all options.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sqlnbfmt.path` | `sqlnbfmt` | The executable: a command on `PATH`, or a path. Relative paths and `${workspaceFolder}` are resolved against the workspace folder. In [Restricted Mode](https://code.visualstudio.com/docs/editor/workspace-trust), a workspace's value is ignored until you trust the folder |
| `sqlnbfmt.dialect` | *(empty)* | SQL dialect: `postgres`, `mysql`, `bigquery`, etc. Overrides the dialect in `pyproject.toml`; when empty, that one is used, or generic SQL |
| `sqlnbfmt.configFile` | *(empty)* | A YAML config file, or a TOML file with a `[tool.sqlnbfmt]` table. Relative paths and `${workspaceFolder}` are resolved against the workspace folder. When empty, `pyproject.toml` is used as described above |

## Troubleshooting

- **Nothing happens on save:** check the **Output** panel (select *sqlnbfmt*). Errors such as a missing `sqlnbfmt` or an invalid configuration are also shown as a notification.
- **A string isn't formatted:** sqlnbfmt leaves a SQL string unchanged when formatting it could change its meaning, e.g. when it would move a query parameter. The status bar briefly says so, and the Output panel lists each string with the reason.

## Example

Before:

```python
query = "select id, name, email from users where active = 1 and role = 'admin' order by name"
```

After:

```python
query = """
SELECT
  id,
  name,
  email
FROM users
WHERE
  active = 1 AND role = 'admin'
ORDER BY
  name
"""
```

## Links

- [sqlnbfmt on PyPI](https://pypi.org/project/sqlnbfmt/)
- [sqlnbfmt on GitHub](https://github.com/flyersworder/sqlnbfmt)
- [Report Issues](https://github.com/flyersworder/vscode-sqlnbfmt/issues)
