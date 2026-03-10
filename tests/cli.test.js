const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.NOTION_TOKEN = "ntn_test";
process.env.NOTION_DATABASE_ID = "db_test";
process.env.ENCRYPTION_KEY = "encryption_test_value";
process.env.NOTION_SYNC_STATE_FILE = path.join(os.tmpdir(), "notion-sync-test-state.json");

let cli = require("../daily-upload.js");

function loadCli() {
  delete require.cache[require.resolve("../daily-upload.js")];
  cli = require("../daily-upload.js");
  return cli;
}

function testNormalizeCommand() {
  assert.equal(cli.normalizeCommand([]), "run");
  assert.equal(cli.normalizeCommand(["help"]), "help");
  assert.equal(cli.normalizeCommand(["doctor"]), "doctor");
  assert.equal(cli.normalizeCommand(["remote"]), "remote");
  assert.equal(cli.normalizeCommand(["export-codex"]), "export-codex");
  assert.equal(cli.normalizeCommand(["export-codex-latest"]), "export-codex-latest");
}

function testSanitizeText() {
  const input = "NOTION_TOKEN=secret_abc Bearer token-value ntn_123 ghp_123";
  const output = cli.sanitizeText(input);
  assert.ok(!output.includes("secret_abc"));
  assert.ok(output.includes("[REDACTED]"));
}

function testStripAnsi() {
  const input = "\u001b[31mred\u001b[0m";
  assert.equal(cli.stripAnsi(input), "red");
}

function testInitializeEnvFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-init-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const message = cli.initializeEnvFile();
    assert.ok(message.includes("Created"));
    assert.ok(fs.existsSync(path.join(tempDir, ".env")));
    const secondMessage = cli.initializeEnvFile();
    assert.ok(secondMessage.includes("already exists"));
  } finally {
    process.chdir(previousCwd);
  }
}

function testDoctorShape() {
  const report = cli.runDoctor();
  assert.equal(typeof report.ok, "boolean");
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.some((check) => check.name === "paths.stateFile"));
}

function testExportCodexSession() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-export-"));
  const inputFile = path.join(tempDir, "session.jsonl");
  const outputFile = path.join(tempDir, "session.md");
  const outputDir = path.join(tempDir, "exports");
  fs.writeFileSync(
    inputFile,
    [
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-03-09T12:00:00.000Z",
        payload: { type: "user_message", message: "Hallo Welt" },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-03-09T12:00:05.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Antwort Text" }],
        },
      }),
    ].join("\n")
  );

  const result = cli.exportCodexSession([inputFile, "--output", outputFile]);
  assert.equal(result.outputPath, outputFile);
  assert.equal(result.count, 2);
  const content = fs.readFileSync(outputFile, "utf8");
  assert.match(content, /Hallo Welt/);
  assert.match(content, /Antwort Text/);
  assert.equal(result.title, "Codex Session Export session");

  const resultWithOutputDir = cli.exportCodexSession([inputFile, "--output-dir", outputDir]);
  assert.equal(resultWithOutputDir.outputPath, path.join(outputDir, "session.md"));
  assert.ok(fs.existsSync(resultWithOutputDir.outputPath));
  assert.equal(resultWithOutputDir.destination, "file");

  const notionTarget = cli.exportCodexSession([inputFile, "--destination", "notion"]);
  assert.equal(notionTarget.destination, "notion");
}

function testExportLatestCodexSession() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-export-latest-"));
  const sessionsDir = path.join(tempDir, "sessions");
  fs.mkdirSync(path.join(sessionsDir, "2026", "03", "09"), { recursive: true });
  const olderFile = path.join(sessionsDir, "2026", "03", "09", "rollout-2026-03-09T10-00-00.jsonl");
  const latestFile = path.join(sessionsDir, "2026", "03", "09", "rollout-2026-03-09T11-00-00.jsonl");
  fs.writeFileSync(
    olderFile,
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-03-09T10:00:00.000Z",
      payload: { type: "user_message", message: "alt" },
    }) + "\n"
  );
  fs.writeFileSync(
    latestFile,
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-03-09T11:00:00.000Z",
      payload: { type: "user_message", message: "neu" },
    }) + "\n"
  );

  process.env.CODEX_SESSIONS_DIR = sessionsDir;
  const cliWithSessions = loadCli();
  const outputFile = path.join(tempDir, "latest.md");
  const result = cliWithSessions.exportLatestCodexSession(["--output", outputFile]);

  assert.equal(result.inputPath, latestFile);
  assert.equal(result.outputPath, outputFile);
  assert.equal(result.count, 1);
  assert.match(fs.readFileSync(outputFile, "utf8"), /neu/);

  delete process.env.CODEX_SESSIONS_DIR;
  loadCli();
}

function testExportLatestCodexSessionBatch() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-export-latest-batch-"));
  const sessionsDir = path.join(tempDir, "sessions");
  const outputDir = path.join(tempDir, "exports");
  fs.mkdirSync(path.join(sessionsDir, "2026", "03", "09"), { recursive: true });
  const fileA = path.join(sessionsDir, "2026", "03", "09", "rollout-2026-03-09T09-00-00.jsonl");
  const fileB = path.join(sessionsDir, "2026", "03", "09", "rollout-2026-03-09T10-00-00.jsonl");
  const fileC = path.join(sessionsDir, "2026", "03", "09", "rollout-2026-03-09T11-00-00.jsonl");
  fs.writeFileSync(fileA, JSON.stringify({ type: "event_msg", timestamp: "2026-03-09T09:00:00.000Z", payload: { type: "user_message", message: "eins" } }) + "\n");
  fs.writeFileSync(fileB, JSON.stringify({ type: "event_msg", timestamp: "2026-03-09T10:00:00.000Z", payload: { type: "user_message", message: "zwei" } }) + "\n");
  fs.writeFileSync(fileC, JSON.stringify({ type: "event_msg", timestamp: "2026-03-09T11:00:00.000Z", payload: { type: "user_message", message: "drei" } }) + "\n");

  process.env.CODEX_SESSIONS_DIR = sessionsDir;
  const cliWithSessions = loadCli();
  const result = cliWithSessions.exportLatestCodexSession(["--latest", "2", "--output-dir", outputDir]);

  assert.equal(result.inputPaths.length, 2);
  assert.equal(result.inputPaths[0], fileB);
  assert.equal(result.inputPaths[1], fileC);
  assert.match(result.outputPath, /batch\.md$/);
  assert.ok(fs.existsSync(result.outputPath));
  const content = fs.readFileSync(result.outputPath, "utf8");
  assert.match(content, /zwei/);
  assert.match(content, /drei/);
  assert.equal(result.destination, "file");

  delete process.env.CODEX_SESSIONS_DIR;
  loadCli();
}

async function testDestinationDispatcher() {
  const result = await cli.deliverCodexExport(
    { destination: "file", outputPath: "/tmp/export.md", count: 2 },
    {
      toNotion: async () => "page_1",
      toRemote: async () => ({ ok: true, url: "https://example.com/remote" }),
      getNotionPageUrl: (pageId) => `https://example.com/${pageId}`,
    }
  );
  assert.equal(result.destination, "file");
  assert.equal(result.outputPath, "/tmp/export.md");
}

function testBuildCodexExportBlocks() {
  const blocks = cli.buildCodexExportBlocks({
    inputPath: "/tmp/session.jsonl",
    count: 2,
    format: "markdown",
    rendered: "# Codex Session Export\n\nHallo",
  });
  assert.equal(blocks[0].type, "heading_2");
  assert.equal(blocks[1].type, "paragraph");
  assert.equal(blocks[2].type, "heading_2");
}

async function testRemoteCodexExportFlow() {
  process.env.NOTION_SYNC_API_URL = "http://127.0.0.1:45232/api/sync";
  process.env.NOTION_SYNC_USER_LABEL = "integration-user";
  process.env.NOTION_SYNC_SOURCE = "integration-test";
  const cliWithRemote = loadCli();

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      assert.equal(payload.userLabel, "integration-user");
      assert.equal(payload.source, "integration-test");
      assert.match(payload.summary, /Codex export entries: 2/);
      assert.match(payload.codexText, /Codex Session Export/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pageId: "page_export_123", url: "https://example.com/page_export_123" }));
    });
  });

  await new Promise((resolve) => server.listen(45232, "127.0.0.1", resolve));

  try {
    const result = await cliWithRemote.uploadCodexExportToRemote({
      title: "Codex Session Export sample",
      count: 2,
      rendered: "# Codex Session Export\n\nHallo",
    });
    assert.equal(result.pageId, "page_export_123");
    assert.equal(result.url, "https://example.com/page_export_123");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.NOTION_SYNC_API_URL;
    delete process.env.NOTION_SYNC_USER_LABEL;
    delete process.env.NOTION_SYNC_SOURCE;
    loadCli();
  }
}

async function testRemoteUploadFlow() {
  process.env.NOTION_SYNC_API_URL = "http://127.0.0.1:45231/api/sync";
  process.env.NOTION_SYNC_USER_LABEL = "integration-user";
  process.env.NOTION_SYNC_SOURCE = "integration-test";
  const cliWithRemote = loadCli();

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      assert.equal(payload.userLabel, "integration-user");
      assert.equal(payload.source, "integration-test");
      assert.match(payload.summary, /Codex entries/);
      assert.match(payload.codexText, /rollout-1\.jsonl/);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pageId: "page_123", url: "https://example.com/page_123" }));
    });
  });

  await new Promise((resolve) => server.listen(45231, "127.0.0.1", resolve));

  try {
    const report = cliWithRemote.buildReport(
      "2026-03-09",
      [{ source: "rollout-1.jsonl", timestamp: "2026-03-09T10:00:00Z", text: "assistant: synced output" }],
      [{ source: "session.log", timestamp: null, text: "build completed" }],
      [{ source: "bash_history", timestamp: "new-1", text: "npm test" }]
    );

    const result = await cliWithRemote.uploadReportToRemote(report);
    assert.equal(result.pageId, "page_123");
    assert.equal(result.url, "https://example.com/page_123");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.NOTION_SYNC_API_URL;
    delete process.env.NOTION_SYNC_USER_LABEL;
    delete process.env.NOTION_SYNC_SOURCE;
    loadCli();
  }
}

async function run() {
  testNormalizeCommand();
  testSanitizeText();
  testStripAnsi();
  testInitializeEnvFile();
  testDoctorShape();
  testExportCodexSession();
  testExportLatestCodexSession();
  testExportLatestCodexSessionBatch();
  testBuildCodexExportBlocks();
  await testDestinationDispatcher();
  await testRemoteUploadFlow();
  await testRemoteCodexExportFlow();
  console.log("cli.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
