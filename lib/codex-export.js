"use strict";

const fs = require("fs");
const path = require("path");
const { resolveExportDestination } = require("./destinations");

function exportCodexSession(argv, dependencies) {
  const { stripAnsi } = dependencies;
  const options = parseCodexExportArgs(argv);
  if (options.help || !options.input) {
    throw new Error(
      "Usage: notion-sync export-codex <session.jsonl> [--output file] [--format markdown|text] [--roles user,assistant] [--send-to-notion|--send-remote]"
    );
  }

  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(
    options.output || buildCodexExportOutputPath(inputPath, options.format, options.outputDir)
  );
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
    .flatMap((entry) => extractCodexReadableEntries(entry, stripAnsi))
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
  return {
    inputPath,
    outputPath,
    count: messages.length,
    messages,
    format: options.format,
    rendered,
    sendToNotion: Boolean(options.sendToNotion),
    sendRemote: Boolean(options.sendRemote),
    destination: resolveExportDestination(options),
    title: options.title || buildCodexExportTitle(inputPath),
  };
}

function exportLatestCodexSession(argv, dependencies) {
  const { walkFiles, codexSessionsDir } = dependencies;
  const options = parseCodexExportArgs(argv);
  const files = walkFiles(codexSessionsDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();

  if (!files.length) {
    throw new Error(`No Codex session files found in ${codexSessionsDir}.`);
  }

  const limit = Math.max(1, Number.parseInt(String(options.latest || "1"), 10) || 1);
  const selectedFiles = files.slice(-limit);

  if (selectedFiles.length === 1) {
    const result = exportCodexSession([selectedFiles[0], ...argv], dependencies);
    return {
      ...result,
      inputPath: selectedFiles[0],
      inputPaths: selectedFiles,
    };
  }

  const batchResults = selectedFiles.map((file) => exportCodexSession([file, ...argv], dependencies));
  const combinedRendered = batchResults
    .map((item) => `# ${path.basename(item.inputPath)}\n\n${item.rendered}`)
    .join("\n\n");
  const outputPath = path.resolve(
    options.output || buildLatestBatchOutputPath(selectedFiles[selectedFiles.length - 1], batchResults[0].format, options.outputDir)
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, combinedRendered);

  return {
    inputPath: selectedFiles[selectedFiles.length - 1],
    inputPaths: selectedFiles,
    outputPath,
    count: batchResults.reduce((sum, item) => sum + item.count, 0),
    messages: batchResults.flatMap((item) => item.messages),
    format: batchResults[0].format,
    rendered: combinedRendered,
    sendToNotion: Boolean(options.sendToNotion),
    sendRemote: Boolean(options.sendRemote),
    destination: resolveExportDestination(options),
    title: options.title || buildLatestBatchTitle(selectedFiles.length, selectedFiles[selectedFiles.length - 1]),
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
    if (arg === "--output-dir") {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--latest") {
      options.latest = argv[index + 1] || "1";
      index += 1;
      continue;
    }
    if (arg === "--send-to-notion") {
      options.sendToNotion = true;
      continue;
    }
    if (arg === "--send-remote") {
      options.sendRemote = true;
      continue;
    }
    if (arg === "--destination") {
      options.destination = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = argv[index + 1];
      index += 1;
      continue;
    }
    if (!options.input) {
      options.input = arg;
    }
  }
  return options;
}

function buildCodexExportTitle(inputPath) {
  return `Codex Session Export ${path.basename(inputPath, path.extname(inputPath))}`;
}

function buildCodexExportOutputPath(inputPath, format, outputDir) {
  const ext = format === "text" ? ".txt" : ".md";
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "exports"), `${base}${ext}`);
}

function buildLatestBatchOutputPath(latestInputPath, format, outputDir) {
  const ext = format === "text" ? ".txt" : ".md";
  const base = path.basename(latestInputPath, path.extname(latestInputPath));
  return path.join(
    outputDir ? path.resolve(outputDir) : path.join(process.cwd(), "exports"),
    `${base}-batch${ext}`
  );
}

function buildLatestBatchTitle(count, latestInputPath) {
  return `Codex Session Export latest ${count} ending ${path.basename(latestInputPath, path.extname(latestInputPath))}`;
}

function parseCodexExportLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractCodexReadableEntries(entry, stripAnsi) {
  const timestamp = entry.timestamp || entry.payload?.timestamp || "";

  if (entry.type === "event_msg" && entry.payload?.message) {
    return [
      {
        timestamp,
        role: mapCodexExportRole(entry.payload.type),
        text: cleanCodexExportText(entry.payload.message, stripAnsi),
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
        text: cleanCodexExportText(part.text, stripAnsi),
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

function cleanCodexExportText(text, stripAnsi) {
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

function buildCodexExportBlocks(result, dependencies) {
  const { headingBlock, paragraphBlock, chunkText } = dependencies;
  const summaryLines = [`Source: ${result.inputPath}`, `Entries: ${result.count}`, `Format: ${result.format}`];

  return [
    headingBlock("Summary"),
    ...chunkText(summaryLines.join("\n"), 1800).map(paragraphBlock),
    headingBlock("Transcript"),
    ...chunkText(result.rendered, 1800).map(paragraphBlock),
  ];
}

module.exports = {
  exportCodexSession,
  exportLatestCodexSession,
  buildCodexExportBlocks,
};
