# Changelog

## 0.3.0

### Added

- `%%sql` cells in notebooks are formatted, and `# sqlnbfmt: skip` skips just its cell, as in Jupyter. Cells used to be formatted as Python files, where `%%sql` doesn't parse
- `sqlnbfmt.path` and `sqlnbfmt.configFile` accept `${workspaceFolder}`

### Changed

- `sqlnbfmt` runs from the folder of the file being formatted instead of the first workspace folder, so the nearest `pyproject.toml` with `[tool.sqlnbfmt]` is used (each project in a monorepo or multi-root workspace gets its own settings). Relative `sqlnbfmt.path` and `sqlnbfmt.configFile` values are still resolved against the workspace folder
- Errors are shown as a notification (once until they're fixed) with a link to the Output panel, instead of only being logged. Strings sqlnbfmt leaves unformatted are mentioned in the status bar
- The CLI runs in the background instead of blocking the editor, and the code action only runs when it's requested (on save or from the Source Action menu), not on every cursor move
- Setting descriptions: an empty `sqlnbfmt.dialect` uses the dialect configured for the project, not auto-detection; `sqlnbfmt.configFile` also accepts TOML

## 0.2.0

- Code Action support, so sqlnbfmt runs alongside Black or Ruff on save; new icon

## 0.1.0

- Initial release
