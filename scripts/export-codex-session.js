#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.input) {
    printHelp();
    process.exit(options.input ? 0 : 1);
  }

  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(
    options.output || buildDefaultOutputPath(inputPath, options.format)
  );
  const format = options.format || "markdown";

  const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).filter(Boolean);
  const allowedRoles = new Set((options.roles || "user,assistant").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const messages = lines
    .map(parseLine)
    .filter(Boolean)
    .flatMap(extractReadableEntries)
    .filter((item) => allowedRoles.has(item.role))
    .filter((item) => !shouldSkip(item))
    .filter(deduplicateAdjacent())
    .filter(Boolean);

  if (!messages.length) {
    throw new Error("No readable Codex messages found in the provided session file.");
  }

  const rendered =
    format === "text"
      ? renderText(inputPath, messages)
      : renderMarkdown(inputPath, messages);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
  console.log(`Exported ${messages.length} entries to ${outputPath}`);
}

function parseArgs(argv) {
  const options = { format: "markdown" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      options.output = argv[++index];
      continue;
    }
    if (arg === "--format") {
      options.format = argv[++index] || "markdown";
      continue;
    }
    if (arg === "--roles") {
      options.roles = argv[++index] || "user,assistant";
      continue;
    }
    if (!options.input) {
      options.input = arg;
      continue;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/export-codex-session.js <session.jsonl> [--output file] [--format markdown|text] [--roles user,assistant]

Examples:
  node scripts/export-codex-session.js ~/.codex/sessions/2026/03/08/session.jsonl
  node scripts/export-codex-session.js session.jsonl --format text --output ./session.txt
  node scripts/export-codex-session.js session.jsonl --roles user,assistant,tool`);
}

function buildDefaultOutputPath(inputPath, format) {
  const ext = format === "text" ? ".txt" : ".md";
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(process.cwd(), `${base}${ext}`);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractReadableEntries(entry) {
  const timestamp = entry.timestamp || entry.payload?.timestamp || "";

  if (entry.type === "event_msg" && entry.payload?.message) {
    return [
      {
        timestamp,
        role: mapEventRole(entry.payload.type),
        text: clean(entry.payload.message),
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
        text: clean(part.text),
      }))
      .filter((item) => item.text);
  }

  return [];
}

function mapEventRole(type) {
  if (type === "user_message") {
    return "user";
  }
  if (type === "agent_message") {
    return "assistant";
  }
  return type || "event";
}

function clean(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .trim();
}

function shouldSkip(item) {
  const text = item.text.trim();
  return (
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<INSTRUCTIONS>")
  );
}

function deduplicateAdjacent() {
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

function renderMarkdown(inputPath, messages) {
  const lines = [
    `# Codex Session Export`,
    ``,
    `Source: \`${inputPath}\``,
    `Entries: ${messages.length}`,
    ``,
  ];

  for (const item of messages) {
    lines.push(`## ${item.role.toUpperCase()}${item.timestamp ? ` · ${item.timestamp}` : ""}`);
    lines.push("");
    lines.push(item.text);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function renderText(inputPath, messages) {
  const lines = [
    "Codex Session Export",
    `Source: ${inputPath}`,
    `Entries: ${messages.length}`,
    "",
  ];

  for (const item of messages) {
    lines.push(`[${item.timestamp || "no-timestamp"}] ${item.role.toUpperCase()}`);
    lines.push(item.text);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

main();
