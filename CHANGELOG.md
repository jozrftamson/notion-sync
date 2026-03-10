# Changelog

## 1.2.0 - 2026-03-10

- Added `--output-dir` for Codex export commands.
- Added `--latest N` batch export support for the newest local Codex sessions.
- Verified batch exports with direct Notion upload.
- Verified batch exports through the hosted remote API.
- Refactored the CLI into dedicated `codex-export`, `notion`, `remote`, and `report` modules.

## 1.1.0 - 2026-03-10

- Added `export-codex` to convert Codex `jsonl` sessions into readable Markdown or text.
- Added `export-codex-latest` to automatically export the newest local Codex session.
- Added `--send-to-notion` for Codex export commands.
- Added `--send-remote` for Codex export commands to route through the hosted web API.
- Expanded CLI test coverage for Codex export and remote export flows.

## 1.0.0 - 2026-03-09

- Initial public release of `@joseftmson/notion-sync`.
- Daily Notion sync for Codex sessions, terminal logs, and shell history.
- Encrypted local sync state.
- Direct Notion upload and remote API upload modes.
- `doctor`, `status`, `report`, `open`, `dry-run`, `run`, and `remote` commands.
