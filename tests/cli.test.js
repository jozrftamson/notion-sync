const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NOTION_TOKEN = "ntn_test";
process.env.NOTION_DATABASE_ID = "db_test";
process.env.ENCRYPTION_KEY = "encryption_test_value";
process.env.NOTION_SYNC_STATE_FILE = path.join(os.tmpdir(), "notion-sync-test-state.json");

const cli = require("../daily-upload.js");

function testNormalizeCommand() {
  assert.equal(cli.normalizeCommand([]), "run");
  assert.equal(cli.normalizeCommand(["help"]), "help");
  assert.equal(cli.normalizeCommand(["doctor"]), "doctor");
  assert.equal(cli.normalizeCommand(["remote"]), "remote");
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

testNormalizeCommand();
testSanitizeText();
testStripAnsi();
testInitializeEnvFile();
testDoctorShape();

console.log("cli.test.js passed");
