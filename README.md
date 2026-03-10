# notion-sync

`notion-sync` is a local-first CLI for turning Codex sessions, terminal logs, and shell history into structured Notion documentation.

It is designed for people who want:
- private local collection
- secret masking before upload
- encrypted local sync state
- direct sync to Notion or remote delivery into a hosted intake API

## Highlights

- Local-first: reads logs from your machine instead of from a browser upload
- Safe-by-default: masks common tokens and stores sync state encrypted
- Flexible delivery: send directly to Notion or to a remote API
- Automation-friendly: works with cron, CI, and hosted intake workflows

## Install

```bash
npm install -g @joseftmson/notion-sync
```

Package:
- `https://www.npmjs.com/package/@joseftmson/notion-sync`

Repository:
- `https://github.com/jozrftamson/notion-sync`

## Setup

1. Create a working folder:

```bash
mkdir notion-sync-workspace
cd notion-sync-workspace
```

2. Generate a starter config:

```bash
notion-sync init
```

3. Edit `.env` and fill in:
- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `ENCRYPTION_KEY`

4. Validate the environment:

```bash
notion-sync doctor
```

5. Preview and sync:

```bash
notion-sync dry-run
notion-sync run
```

Default input paths:

- Codex sessions: `~/.codex/sessions`
- Terminal logs: `~/terminal-logs`
- Shell history: auto-detected from the current shell

Override them with:

- `CODEX_SESSIONS_DIR`
- `TERMINAL_LOG_DIR`
- `SHELL_HISTORY_FILE`
- `NOTION_SYNC_STATE_FILE`
- `NOTION_SYNC_API_URL`
- `NOTION_SYNC_USER_LABEL`
- `NOTION_SYNC_SOURCE`

## Scheduling

Example cron entry:

```cron
55 23 * * * /usr/bin/env notion-sync run >> "$HOME/.local/state/notion-sync/upload.log" 2>&1
```

## Security model

- Local sync state is encrypted with AES-256-GCM using `ENCRYPTION_KEY`.
- Uploads to Notion use HTTPS/TLS.
- Common secrets are masked before upload.
- Raw source logs are never modified.

## Quickstart

```bash
npm install -g @joseftmson/notion-sync
mkdir notion-sync-workspace
cd notion-sync-workspace
notion-sync init
notion-sync doctor
notion-sync report
notion-sync run
```

## Commands

```bash
notion-sync init
notion-sync doctor
notion-sync help
notion-sync status
notion-sync report
notion-sync open
notion-sync dry-run
notion-sync run
notion-sync remote
notion-sync export-codex ~/.codex/sessions/2026/03/09/session.jsonl --output ./exports/session.md
notion-sync export-codex-latest --output ./exports/latest-session.md
```

## Codex session export

Convert a raw Codex `jsonl` session into readable Markdown or text:

```bash
notion-sync export-codex ~/.codex/sessions/2026/03/08/session.jsonl
notion-sync export-codex session.jsonl --format text --output ./session.txt
notion-sync export-codex-latest --output ./latest-session.md
```

This is useful when you want a human-readable chronology before sending the content to Notion.

## Remote upload mode

If you want users to send their local logs into your hosted Vercel app instead of writing directly to Notion from the CLI:

```bash
export NOTION_SYNC_API_URL="https://your-app.vercel.app/api/sync"
export NOTION_SYNC_USER_LABEL="alice"
notion-sync remote
```

This sends the current collected report to the remote API. The Vercel app can then create the Notion page centrally.

## Screenshots

Suggested screenshots for the repository:
- CLI `doctor` output
- CLI `report` preview
- successful `remote` upload response

Recommended asset paths:
- `docs/screenshots/cli-doctor.png`
- `docs/screenshots/cli-report.png`
- `docs/screenshots/cli-remote.png`
