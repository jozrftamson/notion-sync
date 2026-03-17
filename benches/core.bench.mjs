import { bench, describe } from "vitest";
import { sanitizeText, stripAnsi, normalizeCommand, buildReport } from "../daily-upload.js";
import { chunkText, headingBlock, paragraphBlock, createBlocks } from "../lib/notion.js";
import { renderReportPreview } from "../lib/report.js";

// --- sanitizeText ---

describe("sanitizeText", () => {
  const clean = "This is a normal log line with no secrets at all.";
  const withSecrets =
    "NOTION_TOKEN=ntn_abc123 Bearer token-value sk-proj-key ghp_abc123 secret_xyz";
  const longText = (clean + " ").repeat(200);

  bench("clean text", () => {
    sanitizeText(clean);
  });

  bench("text with secrets", () => {
    sanitizeText(withSecrets);
  });

  bench("long text", () => {
    sanitizeText(longText);
  });
});

// --- stripAnsi ---

describe("stripAnsi", () => {
  const plain = "plain text without escape codes";
  const ansi =
    "\u001b[31mred\u001b[0m \u001b[1;32mbold green\u001b[0m \u001b[4munderline\u001b[0m normal";
  const heavy = (ansi + " ").repeat(100);

  bench("plain text", () => {
    stripAnsi(plain);
  });

  bench("text with ANSI codes", () => {
    stripAnsi(ansi);
  });

  bench("heavy ANSI text", () => {
    stripAnsi(heavy);
  });
});

// --- chunkText ---

describe("chunkText", () => {
  const short = "Hello world";
  const medium = "x".repeat(5000);
  const long = "y".repeat(20000);

  bench("short text", () => {
    chunkText(short, 1800);
  });

  bench("medium text (5KB)", () => {
    chunkText(medium, 1800);
  });

  bench("long text (20KB)", () => {
    chunkText(long, 1800);
  });
});

// --- normalizeCommand ---

describe("normalizeCommand", () => {
  bench("run command", () => {
    normalizeCommand(["run"]);
  });

  bench("doctor command", () => {
    normalizeCommand(["doctor"]);
  });

  bench("export-codex command", () => {
    normalizeCommand(["export-codex"]);
  });

  bench("help command", () => {
    normalizeCommand(["--help"]);
  });

  bench("empty args (default run)", () => {
    normalizeCommand([]);
  });
});

// --- buildReport ---

describe("buildReport", () => {
  const codexEntries = Array.from({ length: 20 }, (_, i) => ({
    source: `session-${i}.jsonl`,
    timestamp: `2026-03-09T${String(10 + i).padStart(2, "0")}:00:00Z`,
    text: `assistant: This is a sample Codex response number ${i} with some content.`,
  }));

  const terminalEntries = Array.from({ length: 10 }, (_, i) => ({
    source: `terminal-${i}.log`,
    timestamp: null,
    text: `npm run build && npm test -- iteration ${i}`,
  }));

  const shellEntries = Array.from({ length: 30 }, (_, i) => ({
    source: "bash_history",
    timestamp: `new-${i + 1}`,
    text: `git commit -m "update ${i}"`,
  }));

  bench("small report (few entries)", () => {
    buildReport(
      "2026-03-09",
      codexEntries.slice(0, 3),
      terminalEntries.slice(0, 2),
      shellEntries.slice(0, 5),
    );
  });

  bench("full report", () => {
    buildReport("2026-03-09", codexEntries, terminalEntries, shellEntries);
  });
});

// --- renderReportPreview ---

describe("renderReportPreview", () => {
  function makeReport() {
    const deps = {
      createBlocks(sections) {
        return createBlocks(sections, { headingBlock, paragraphBlock, chunkText });
      },
    };
    const { buildReport: buildReportCore } = require("../lib/report.js");
    const codex = Array.from({ length: 10 }, (_, i) => ({
      source: `session-${i}.jsonl`,
      timestamp: `2026-03-09T${String(10 + i).padStart(2, "0")}:00:00Z`,
      text: `assistant: Sample response ${i}`,
    }));
    const terminal = [{ source: "term.log", timestamp: null, text: "npm test" }];
    const shell = [{ source: "bash_history", timestamp: "new-1", text: "ls -la" }];
    return buildReportCore("2026-03-09", codex, terminal, shell, deps);
  }

  const report = makeReport();

  bench("render preview", () => {
    renderReportPreview(report);
  });
});
