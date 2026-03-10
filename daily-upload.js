#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

loadEnv(path.join(__dirname, ".env"));

const args = process.argv.slice(2);
const command = normalizeCommand(args);
const DRY_RUN = command === "dry-run";
const INIT_ONLY = command === "init";
const DOCTOR_ONLY = command === "doctor";
const STATUS_ONLY = command === "status";
const REPORT_ONLY = command === "report";
const OPEN_ONLY = command === "open";
const REMOTE_ONLY = command === "remote";
const EXPORT_CODEX_ONLY = command === "export-codex";
const EXPORT_CODEX_LATEST_ONLY = command === "export-codex-latest";
const HELP_ONLY = command === "help";
const APP_DIR = getAppDir();
const CONFIG = {
  notionToken: process.env.NOTION_TOKEN || "",
  notionDatabaseId: process.env.NOTION_DATABASE_ID || "",
  notionTitleProperty: process.env.NOTION_TITLE_PROPERTY || "Name",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  codexSessionsDir: process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), ".codex", "sessions"),
  terminalLogDir: process.env.TERMINAL_LOG_DIR || path.join(os.homedir(), "terminal-logs"),
  shellHistoryFile: process.env.SHELL_HISTORY_FILE || getDefaultShellHistoryFile(),
  timezone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  stateFile: process.env.NOTION_SYNC_STATE_FILE || path.join(APP_DIR, "state.enc.json"),
  remoteApiUrl: process.env.NOTION_SYNC_API_URL || "",
  remoteUserLabel: process.env.NOTION_SYNC_USER_LABEL || os.userInfo().username || "unknown-user",
  remoteSource: process.env.NOTION_SYNC_SOURCE || "notion-sync CLI",
};

const SECRET_PATTERNS = [
  /ntn_[A-Za-z0-9]+/g,
  /secret_[A-Za-z0-9]+/g,
  /sk-[A-Za-z0-9_-]+/g,
  /ghp_[A-Za-z0-9]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /NOTION_TOKEN\s*=\s*.+/g,
  /OPENAI_API_KEY\s*=\s*.+/g,
  /CLIENT_KEY_[A-Za-z0-9_]*\s*=\s*.+/g,
];

async function main() {
  if (HELP_ONLY) {
    console.log(getHelpText());
    return;
  }

  if (INIT_ONLY) {
    console.log(initializeEnvFile());
    return;
  }

  if (DOCTOR_ONLY) {
    console.log(JSON.stringify(runDoctor(), null, 2));
    return;
  }

  if (EXPORT_CODEX_ONLY) {
    const result = exportCodexSession(args.slice(1));
    console.log(`Exported ${result.count} entries to ${result.outputPath}`);
    return;
  }

  if (EXPORT_CODEX_LATEST_ONLY) {
    const result = exportLatestCodexSession(args.slice(1));
    console.log(`Exported ${result.count} entries from ${result.inputPath} to ${result.outputPath}`);
    return;
  }

  const reportDate = getReportDate(new Date(), CONFIG.timezone);
  const state = loadState();
  const codexResult = collectCodexEntries(reportDate, state.progress?.codex || {});
  const terminalResult = collectTerminalEntries(reportDate, state.progress?.terminal || {});
  const shellResult = collectShellEntries(state.progress?.shell || {});
  const codexEntries = codexResult.entries;
  const terminalEntries = terminalResult.entries;
  const shellEntries = shellResult.entries;
  const report = buildReport(reportDate, codexEntries, terminalEntries, shellEntries);

  if (STATUS_ONLY) {
    console.log(
      JSON.stringify(
        {
          lastUpload: state.lastUpload || null,
          lastReportDate: state.lastReportDate || null,
          lastPageId: state.lastPageId || null,
          pending: report.preview,
        },
        null,
        2
      )
    );
    return;
  }

  if (OPEN_ONLY) {
    if (!state.lastPageId) {
      throw new Error("No synced Notion page found in local state yet.");
    }
    console.log(getNotionPageUrl(state.lastPageId));
    return;
  }

  if (REPORT_ONLY) {
    console.log(renderReportPreview(report));
    return;
  }

  if (REMOTE_ONLY) {
    const result = await uploadReportToRemote(report);
    state.lastRemoteUpload = new Date().toISOString();
    state.lastRemoteUrl = result.url;
    state.lastRemotePageId = result.pageId;
    state.progress = {
      codex: codexResult.progress,
      terminal: terminalResult.progress,
      shell: shellResult.progress,
    };
    saveState(state);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(report.preview, null, 2));
    return;
  }

  ensureLocalNotionConfig();

  if (!report.hasChanges) {
    console.log(`No new entries for ${reportDate}.`);
    return;
  }

  const pageId = await upsertDailyPage(report);
  await replacePageBlocks(pageId, report.blocks);
  state.lastUpload = new Date().toISOString();
  state.lastReportDate = reportDate;
  state.lastPageId = pageId;
  state.lastHashes = report.hashes;
  state.progress = {
    codex: codexResult.progress,
    terminal: terminalResult.progress,
    shell: shellResult.progress,
  };
  saveState(state);
  console.log(`Uploaded report for ${reportDate}: ${pageId}`);
}

function getNotionPageUrl(pageId) {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

function getHelpText() {
  return [
    "notion-sync commands:",
    "  notion-sync help     Show this help text",
    "  notion-sync init     Create a local .env from the example template",
    "  notion-sync doctor   Check config, paths, and remote upload setup",
    "  notion-sync status   Show last sync info and pending new entries",
    "  notion-sync report   Preview the next upload in the terminal",
    "  notion-sync open     Print the last synced Notion page URL",
    "  notion-sync remote   Send the current report to a remote API",
    "  notion-sync export-codex <session.jsonl> [--output file] [--format markdown|text] [--roles user,assistant]",
    "  notion-sync export-codex-latest [--output file] [--format markdown|text] [--roles user,assistant]",
    "  notion-sync dry-run  Build the next report without uploading",
    "  notion-sync run      Upload the next report to Notion",
    "",
    "Config file:",
    `  ${path.join(__dirname, ".env")}`,
    "State file:",
    `  ${CONFIG.stateFile}`,
    "Remote API URL env:",
    "  NOTION_SYNC_API_URL",
    "",
    "npm scripts still work:",
    "  npm run help | status | report | open | dry-run | run",
  ].join("\n");
}

function normalizeCommand(argv) {
  const first = argv[0];

  if (!first || first === "run") {
    return "run";
  }
  if (first === "--init" || first === "init") {
    return "init";
  }
  if (first === "--doctor" || first === "doctor") {
    return "doctor";
  }
  if (first === "--dry-run" || first === "dry-run") {
    return "dry-run";
  }
  if (first === "--status" || first === "status") {
    return "status";
  }
  if (first === "--report" || first === "report") {
    return "report";
  }
  if (first === "--open" || first === "open") {
    return "open";
  }
  if (first === "--remote" || first === "remote") {
    return "remote";
  }
  if (first === "export-codex") {
    return "export-codex";
  }
  if (first === "export-codex-latest") {
    return "export-codex-latest";
  }
  if (first === "--help" || first === "-h" || first === "help") {
    return "help";
  }

  throw new Error(`Unknown command: ${first}`);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Set it in environment variables or ${path.join(__dirname, ".env")}.`);
  }
  return value;
}

function ensureLocalNotionConfig() {
  if (!CONFIG.notionToken) {
    throw new Error(`Missing NOTION_TOKEN. Set it in environment variables or ${path.join(__dirname, ".env")}.`);
  }
  if (!CONFIG.notionDatabaseId) {
    throw new Error(`Missing NOTION_DATABASE_ID. Set it in environment variables or ${path.join(__dirname, ".env")}.`);
  }
  if (!CONFIG.encryptionKey) {
    throw new Error(`Missing ENCRYPTION_KEY. Set it in environment variables or ${path.join(__dirname, ".env")}.`);
  }
}

function getReportDate(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function loadState() {
  ensureAppDir();
  if (!CONFIG.encryptionKey) {
    return {};
  }
  if (!fs.existsSync(CONFIG.stateFile)) {
    return {};
  }

  const encrypted = JSON.parse(fs.readFileSync(CONFIG.stateFile, "utf8"));
  const key = deriveKey(CONFIG.encryptionKey, encrypted.salt);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function saveState(state) {
  ensureAppDir();
  if (!CONFIG.encryptionKey) {
    return;
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(CONFIG.encryptionKey, salt.toString("hex"));
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(state, null, 2), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: ciphertext.toString("hex"),
  };
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(payload, null, 2));
}

function deriveKey(secret, saltHex) {
  return crypto.scryptSync(secret, Buffer.from(saltHex, "hex"), 32);
}

function collectCodexEntries(reportDate, progressState) {
  const files = walkFiles(CONFIG.codexSessionsDir).filter((file) => file.endsWith(".jsonl"));
  const entries = [];
  const nextProgress = {};

  for (const file of files) {
    if (!file.includes(`/${reportDate.replace(/-/g, "/")}/`)) {
      continue;
    }
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const previousLineCount = progressState[file]?.lineCount || 0;
    for (let index = previousLineCount; index < lines.length; index += 1) {
      const line = lines[index];
      try {
        const item = JSON.parse(line);
        const text = extractCodexText(item);
        if (!text) {
          continue;
        }
        entries.push({
          source: path.basename(file),
          timestamp: item.timestamp || null,
          text: sanitizeText(text),
        });
      } catch {
        continue;
      }
    }
    nextProgress[file] = {
      lineCount: lines.length,
    };
  }

  return { entries, progress: nextProgress };
}

function extractCodexText(item) {
  if (item.type === "response_item" && item.payload?.type === "message") {
    const parts = item.payload.content || [];
    return parts
      .filter((part) => part.type === "input_text" || part.type === "output_text")
      .map((part) => `${item.payload.role}: ${part.text}`)
      .join("\n");
  }

  if (item.type === "event_msg" && item.payload?.message) {
    return `${item.payload.type || "event"}: ${item.payload.message}`;
  }

  return null;
}

function collectTerminalEntries(reportDate, progressState) {
  if (!fs.existsSync(CONFIG.terminalLogDir)) {
    return { entries: [], progress: {} };
  }

  const files = fs
    .readdirSync(CONFIG.terminalLogDir)
    .filter((file) => file.includes(reportDate) && file.endsWith(".log"))
    .sort();
  const entries = [];
  const nextProgress = {};

  for (const file of files) {
    const fullPath = path.join(CONFIG.terminalLogDir, file);
    const text = fs.readFileSync(fullPath, "utf8");
    const previousSize = progressState[file]?.size || 0;
    const nextSize = Buffer.byteLength(text, "utf8");
    const delta = previousSize > 0 ? text.slice(previousSize) : text;
    if (delta.trim()) {
      entries.push({
        source: file,
        timestamp: null,
        text: sanitizeText(stripAnsi(delta)).slice(0, 8000),
      });
    }
    nextProgress[file] = {
      size: nextSize,
    };
  }

  return { entries, progress: nextProgress };
}

function collectShellEntries(progressState) {
  if (!fs.existsSync(CONFIG.shellHistoryFile)) {
    return { entries: [], progress: {} };
  }

  const lines = fs.readFileSync(CONFIG.shellHistoryFile, "utf8").split(/\r?\n/).filter(Boolean);
  const previousLineCount = progressState.lineCount || 0;
  const startIndex = Math.min(previousLineCount, lines.length);
  const entries = lines.slice(startIndex).map((line, index) => ({
    source: "bash_history",
    timestamp: `new-${startIndex + index + 1}`,
    text: sanitizeText(line),
  }));
  return {
    entries,
    progress: {
      lineCount: lines.length,
    },
  };
}

function buildReport(reportDate, codexEntries, terminalEntries, shellEntries) {
  const codexSummary = summarizeEntries(codexEntries, 12);
  const terminalSummary = summarizeEntries(terminalEntries, 8);
  const shellSummary = summarizeEntries(shellEntries, 20);
  const codexText = codexSummary.join("\n").slice(0, 4000);
  const terminalText = terminalSummary.join("\n").slice(0, 4000);
  const shellText = shellSummary.join("\n").slice(0, 2000);
  const summary = [
    `Codex entries: ${codexEntries.length}`,
    `Terminal logs: ${terminalEntries.length}`,
    `Shell commands captured: ${shellEntries.length}`,
  ].join(" | ");

  const blocks = createBlocks([
    `Daily automation report for ${reportDate}.`,
    summary,
    "Codex History",
    codexText || "No Codex session data found for this day.",
    "Terminal Logs",
    terminalText || "No terminal log files found for this day.",
    "Recent Shell History",
    shellText || "No shell history file found.",
  ]);

  return {
    title: `Daily Codex Log ${reportDate}`,
    reportDate,
    blocks,
    hasChanges: codexEntries.length > 0 || terminalEntries.length > 0 || shellEntries.length > 0,
    preview: {
      title: `Daily Codex Log ${reportDate}`,
      summary,
      codexEntries: codexEntries.length,
      terminalEntries: terminalEntries.length,
      shellEntries: shellEntries.length,
    },
    hashes: {
      codex: sha256(codexText),
      terminal: sha256(terminalText),
      shell: sha256(shellText),
    },
  };
}

function formatEntry(entry) {
  const prefix = entry.timestamp ? `[${entry.timestamp}] ` : "";
  return `${prefix}${entry.source}\n${entry.text}`;
}

function summarizeEntries(entries, limit) {
  return entries.slice(0, limit).map((entry) => {
    const firstLine = entry.text.split("\n").find((line) => line.trim()) || "";
    const condensed = firstLine.replace(/\s+/g, " ").slice(0, 220);
    const prefix = entry.timestamp ? `[${entry.timestamp}] ` : "";
    return `${prefix}${entry.source}: ${condensed}`;
  });
}

function sanitizeText(text) {
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function createBlocks(sections) {
  const blocks = [];
  for (let i = 0; i < sections.length; i += 2) {
    const heading = sections[i];
    const body = sections[i + 1];
    blocks.push(headingBlock(i === 0 ? "Summary" : heading));
    for (const chunk of chunkText(body, 1800)) {
      blocks.push(paragraphBlock(chunk));
    }
  }
  return blocks;
}

function headingBlock(text) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [richText(text)],
    },
  };
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [richText(text)],
    },
  };
}

function richText(text) {
  return {
    type: "text",
    text: {
      content: text,
    },
  };
}

function chunkText(text, size) {
  if (!text) {
    return [""];
  }
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function renderReportPreview(report) {
  const lines = [
    `Title: ${report.title}`,
    `Date: ${report.reportDate}`,
    `Summary: ${report.preview.summary}`,
    "",
  ];

  for (const block of report.blocks) {
    if (block.type === "heading_2") {
      lines.push(`## ${block.heading_2.rich_text[0].text.content}`);
    }
    if (block.type === "paragraph") {
      lines.push(block.paragraph.rich_text[0].text.content);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

async function uploadReportToRemote(report) {
  if (!CONFIG.remoteApiUrl) {
    throw new Error("Missing NOTION_SYNC_API_URL for remote upload.");
  }

  if (!report.hasChanges) {
    return {
      ok: true,
      skipped: true,
      reason: `No new entries for ${report.reportDate}.`,
    };
  }

  const payload = {
    title: report.title,
    userLabel: CONFIG.remoteUserLabel,
    source: CONFIG.remoteSource,
    summary: report.preview.summary,
    codexText: collectSummaryText(report, "Codex History"),
    terminalText: collectSummaryText(report, "Terminal Logs"),
    shellText: collectSummaryText(report, "Recent Shell History"),
  };

  const response = await fetch(CONFIG.remoteApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Remote upload failed (${response.status}).`);
  }

  return result;
}

function collectSummaryText(report, headingName) {
  const lines = [];
  let capture = false;

  for (const block of report.blocks) {
    if (block.type === "heading_2") {
      const heading = block.heading_2.rich_text[0].text.content;
      capture = heading === headingName;
      continue;
    }

    if (capture && block.type === "paragraph") {
      const text = block.paragraph.rich_text.map((part) => part.text.content).join("");
      lines.push(text);
    }
  }

  return lines.join("\n").trim();
}

async function upsertDailyPage(report) {
  const query = await notionRequest(`/v1/databases/${CONFIG.notionDatabaseId}/query`, {
    method: "POST",
    body: {
      filter: {
        property: CONFIG.notionTitleProperty,
        title: {
          equals: report.title,
        },
      },
    },
  });

  if (query.results?.length) {
    return query.results[0].id;
  }

  const page = await notionRequest("/v1/pages", {
    method: "POST",
    body: {
      parent: {
        database_id: CONFIG.notionDatabaseId,
      },
      properties: {
        [CONFIG.notionTitleProperty]: {
          title: [{ text: { content: report.title } }],
        },
      },
    },
  });

  return page.id;
}

async function replacePageBlocks(pageId, blocks) {
  const existing = await notionRequest(`/v1/blocks/${pageId}/children?page_size=100`, {
    method: "GET",
  });

  for (const block of existing.results || []) {
    await notionRequest(`/v1/blocks/${block.id}`, {
      method: "PATCH",
      body: {
        archived: true,
      },
    });
  }

  for (let index = 0; index < blocks.length; index += 50) {
    await notionRequest(`/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      body: {
        children: blocks.slice(index, index + 50),
      },
    });
  }
}

async function notionRequest(endpoint, options) {
  const response = await fetch(`https://api.notion.com${endpoint}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${CONFIG.notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion request failed (${response.status}): ${text}`);
  }

  return response.status === 204 ? {} : response.json();
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function getAppDir() {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return path.join(xdgStateHome, "notion-sync");
  }
  return path.join(os.homedir(), ".local", "state", "notion-sync");
}

function ensureAppDir() {
  fs.mkdirSync(APP_DIR, { recursive: true });
}

function getDefaultShellHistoryFile() {
  const shell = process.env.SHELL || "";
  if (shell.endsWith("zsh")) {
    return path.join(os.homedir(), ".zsh_history");
  }
  if (shell.endsWith("fish")) {
    return path.join(os.homedir(), ".local", "share", "fish", "fish_history");
  }
  return path.join(os.homedir(), ".bash_history");
}

function initializeEnvFile() {
  const targetPath = path.join(process.cwd(), ".env");
  const sourcePath = path.join(__dirname, ".env.example");

  if (fs.existsSync(targetPath)) {
    return `.env already exists at ${targetPath}`;
  }

  const content = fs.readFileSync(sourcePath, "utf8");
  fs.writeFileSync(targetPath, content);
  return `Created ${targetPath} from ${sourcePath}`;
}

function runDoctor() {
  const checks = [];

  checks.push(checkValue("config.notionToken", Boolean(CONFIG.notionToken), CONFIG.notionToken ? "set" : "missing"));
  checks.push(
    checkValue(
      "config.notionDatabaseId",
      Boolean(CONFIG.notionDatabaseId),
      CONFIG.notionDatabaseId ? "set" : "missing"
    )
  );
  checks.push(
    checkValue(
      "config.encryptionKey",
      Boolean(CONFIG.encryptionKey),
      CONFIG.encryptionKey ? "set" : "missing"
    )
  );
  checks.push(checkPath("paths.codexSessionsDir", CONFIG.codexSessionsDir));
  checks.push(checkPath("paths.terminalLogDir", CONFIG.terminalLogDir));
  checks.push(checkPath("paths.shellHistoryFile", CONFIG.shellHistoryFile));
  checks.push(checkValue("paths.stateFile", true, CONFIG.stateFile));
  checks.push(
    checkValue(
      "remote.apiUrl",
      Boolean(CONFIG.remoteApiUrl),
      CONFIG.remoteApiUrl || "missing"
    )
  );
  checks.push(
    checkValue(
      "remote.userLabel",
      Boolean(CONFIG.remoteUserLabel),
      CONFIG.remoteUserLabel || "missing"
    )
  );

  const requiredFailures = checks.filter(
    (item) =>
      !item.ok &&
      !item.name.startsWith("remote.")
  );
  const ok = requiredFailures.length === 0;
  return {
    ok,
    command: "doctor",
    checks,
  };
}

function exportCodexSession(argv) {
  const options = parseCodexExportArgs(argv);
  if (options.help || !options.input) {
    throw new Error(
      "Usage: notion-sync export-codex <session.jsonl> [--output file] [--format markdown|text] [--roles user,assistant]"
    );
  }

  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output || buildCodexExportOutputPath(inputPath, options.format));
  const allowedRoles = new Set(
    (options.roles || "user,assistant")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).filter(Boolean);
  const messages = lines
    .map(parseCodexExportLine)
    .filter(Boolean)
    .flatMap(extractCodexReadableEntries)
    .filter((item) => allowedRoles.has(item.role))
    .filter((item) => !shouldSkipCodexExportItem(item))
    .filter(deduplicateCodexExportAdjacent());

  if (!messages.length) {
    throw new Error("No readable Codex messages found in the provided session file.");
  }

  const rendered =
    options.format === "text"
      ? renderCodexExportText(inputPath, messages)
      : renderCodexExportMarkdown(inputPath, messages);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
  return { outputPath, count: messages.length };
}

function exportLatestCodexSession(argv) {
  const files = walkFiles(CONFIG.codexSessionsDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  if (!files.length) {
    throw new Error(`No Codex session files found in ${CONFIG.codexSessionsDir}.`);
  }

  const latestFile = files[files.length - 1];
  const result = exportCodexSession([latestFile, ...argv]);
  return {
    inputPath: latestFile,
    outputPath: result.outputPath,
    count: result.count,
  };
}

function parseCodexExportArgs(argv) {
  const options = { format: "markdown" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = argv[index + 1] || "markdown";
      index += 1;
      continue;
    }
    if (arg === "--roles") {
      options.roles = argv[index + 1] || "user,assistant";
      index += 1;
      continue;
    }
    if (!options.input) {
      options.input = arg;
    }
  }
  return options;
}

function buildCodexExportOutputPath(inputPath, format) {
  const ext = format === "text" ? ".txt" : ".md";
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(process.cwd(), `${base}${ext}`);
}

function parseCodexExportLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractCodexReadableEntries(entry) {
  const timestamp = entry.timestamp || entry.payload?.timestamp || "";

  if (entry.type === "event_msg" && entry.payload?.message) {
    return [
      {
        timestamp,
        role: mapCodexExportRole(entry.payload.type),
        text: cleanCodexExportText(entry.payload.message),
      },
    ];
  }

  if (entry.type === "response_item" && entry.payload?.type === "message") {
    const role = entry.payload.role || "assistant";
    return (entry.payload.content || [])
      .filter((part) => part.type === "input_text" || part.type === "output_text")
      .map((part) => ({
        timestamp,
        role,
        text: cleanCodexExportText(part.text),
      }))
      .filter((item) => item.text);
  }

  return [];
}

function mapCodexExportRole(type) {
  if (type === "user_message") {
    return "user";
  }
  if (type === "agent_message") {
    return "assistant";
  }
  return type || "event";
}

function cleanCodexExportText(text) {
  return stripAnsi(String(text || "").replace(/\r/g, "")).trim();
}

function shouldSkipCodexExportItem(item) {
  const text = item.text.trim();
  return (
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<INSTRUCTIONS>")
  );
}

function deduplicateCodexExportAdjacent() {
  let previous = null;
  return (item) => {
    const signature = `${item.role}|${item.timestamp}|${item.text}`;
    if (signature === previous) {
      return false;
    }
    previous = signature;
    return true;
  };
}

function renderCodexExportMarkdown(inputPath, messages) {
  const lines = ["# Codex Session Export", "", `Source: \`${inputPath}\``, `Entries: ${messages.length}`, ""];
  for (const item of messages) {
    lines.push(`## ${item.role.toUpperCase()}${item.timestamp ? ` · ${item.timestamp}` : ""}`);
    lines.push("");
    lines.push(item.text);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function renderCodexExportText(inputPath, messages) {
  const lines = ["Codex Session Export", `Source: ${inputPath}`, `Entries: ${messages.length}`, ""];
  for (const item of messages) {
    lines.push(`[${item.timestamp || "no-timestamp"}] ${item.role.toUpperCase()}`);
    lines.push(item.text);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function checkPath(name, targetPath) {
  return {
    name,
    ok: fs.existsSync(targetPath),
    value: targetPath,
  };
}

function checkValue(name, ok, value) {
  return {
    name,
    ok,
    value,
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildReport,
  collectSummaryText,
  normalizeCommand,
  sanitizeText,
  stripAnsi,
  initializeEnvFile,
  runDoctor,
  uploadReportToRemote,
  exportCodexSession,
  exportLatestCodexSession,
};
