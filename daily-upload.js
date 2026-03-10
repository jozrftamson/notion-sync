#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  exportCodexSession: runCodexExport,
  exportLatestCodexSession: runLatestCodexExport,
} = require("./lib/codex-export");
const {
  upsertDailyPage: upsertDailyPageCore,
  uploadCodexExportToNotion: uploadCodexExportToNotionCore,
  createNotionRequest,
  createBlocks: createNotionBlocks,
  buildCodexExportBlocks: buildCodexExportBlocksCore,
  headingBlock,
  paragraphBlock,
  chunkText,
} = require("./lib/notion");
const {
  uploadReportToRemote: uploadReportToRemoteCore,
  uploadCodexExportToRemote: uploadCodexExportToRemoteCore,
  collectSummaryText,
} = require("./lib/remote");
const { deliverCodexExport } = require("./lib/destinations");
const {
  buildReport: buildReportCore,
  sanitizeText,
  stripAnsi,
  renderReportPreview,
} = require("./lib/report");

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
const notionRequest = createNotionRequest(CONFIG);

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
    if (result.destination === "notion") {
      ensureLocalNotionConfig();
    }
    const delivery = await deliverCodexExport(result, {
      toNotion: uploadCodexExportToNotion,
      toRemote: uploadCodexExportToRemote,
      getNotionPageUrl,
    });
    if (delivery.destination === "notion") {
      console.log(`Exported ${result.count} entries to ${result.outputPath} and uploaded to ${delivery.url}`);
      return;
    }
    if (delivery.destination === "remote") {
      console.log(`Exported ${result.count} entries to ${result.outputPath} and sent to remote ${delivery.url || "(no url returned)"}`);
      return;
    }
    console.log(`Exported ${result.count} entries to ${result.outputPath}`);
    return;
  }

  if (EXPORT_CODEX_LATEST_ONLY) {
    const result = exportLatestCodexSession(args.slice(1));
    if (result.destination === "notion") {
      ensureLocalNotionConfig();
    }
    const delivery = await deliverCodexExport(result, {
      toNotion: uploadCodexExportToNotion,
      toRemote: uploadCodexExportToRemote,
      getNotionPageUrl,
    });
    if (delivery.destination === "notion") {
      console.log(`Exported ${result.count} entries from ${result.inputPath} to ${result.outputPath} and uploaded to ${delivery.url}`);
      return;
    }
    if (delivery.destination === "remote") {
      console.log(`Exported ${result.count} entries from ${result.inputPath} to ${result.outputPath} and sent to remote ${delivery.url || "(no url returned)"}`);
      return;
    }
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
    "  notion-sync export-codex <session.jsonl> [--output file] [--output-dir dir] [--format markdown|text] [--roles user,assistant] [--destination file|notion|remote]",
    "  notion-sync export-codex-latest [--output file] [--output-dir dir] [--latest N] [--format markdown|text] [--roles user,assistant] [--destination file|notion|remote]",
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
          text: sanitizeText(text, SECRET_PATTERNS),
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
        text: sanitizeText(stripAnsi(delta), SECRET_PATTERNS).slice(0, 8000),
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
    text: sanitizeText(line, SECRET_PATTERNS),
  }));
  return {
    entries,
    progress: {
      lineCount: lines.length,
    },
  };
}

function buildReport(reportDate, codexEntries, terminalEntries, shellEntries) {
  return buildReportCore(reportDate, codexEntries, terminalEntries, shellEntries, { createBlocks });
}

function createBlocks(sections) {
  return createNotionBlocks(sections, { headingBlock, paragraphBlock, chunkText });
}

async function uploadReportToRemote(report) {
  return uploadReportToRemoteCore(report, CONFIG, collectSummaryText);
}

async function upsertDailyPage(report) {
  return upsertDailyPageCore(report, CONFIG, notionRequest);
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
  return runCodexExport(argv, { stripAnsi });
}

function exportLatestCodexSession(argv) {
  return runLatestCodexExport(argv, {
    stripAnsi,
    walkFiles,
    codexSessionsDir: CONFIG.codexSessionsDir,
  });
}

async function uploadCodexExportToNotion(result) {
  return uploadCodexExportToNotionCore(result, CONFIG, notionRequest, {
    headingBlock,
    paragraphBlock,
    chunkText,
  });
}

function buildCodexExportBlocks(result) {
  return buildCodexExportBlocksCore(result, { headingBlock, paragraphBlock, chunkText });
}

async function uploadCodexExportToRemote(result) {
  return uploadCodexExportToRemoteCore(result, CONFIG);
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
  deliverCodexExport,
  exportCodexSession,
  exportLatestCodexSession,
  buildCodexExportBlocks,
  uploadCodexExportToRemote,
};
