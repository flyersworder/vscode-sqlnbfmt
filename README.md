# sqlnbfmt — SQL Notebook Formatter

Format SQL queries in Jupyter notebooks and Python files directly from VS Code.

## Features

- **Format on Save** — automatically formats SQL in `.ipynb` notebook cells and `.py` files
- **Format Notebook** — command to format all SQL in an entire notebook at once
- **Jupyter + Marimo** — works with `.ipynb` notebooks and Marimo `.py` notebooks
- **Smart Detection** — finds SQL in Python strings, `%%sql` magic cells, `mo.sql()` calls, and f-strings
- **Zero Config** — works out of the box with sensible defaults

## Prerequisites

Install the `sqlnbfmt` CLI tool:

```bash
pip install sqlnbfmt
```

## Usage

### Format on Save

Set sqlnbfmt as your default Python formatter and enable format on save:

```json
{
  "[python]": {
    "editor.defaultFormatter": "flyersworder.sqlnbfmt",
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

Right-click in a notebook cell and select **Format Cell**, or use the keyboard shortcut (`Shift+Alt+F`).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sqlnbfmt.path` | `sqlnbfmt` | Path to the sqlnbfmt executable |
| `sqlnbfmt.dialect` | *(auto)* | SQL dialect: `postgres`, `mysql`, `bigquery`, etc. |
| `sqlnbfmt.configFile` | *(none)* | Path to a `config.yaml` file |

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
