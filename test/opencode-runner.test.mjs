import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("OpenCode v2 runs privately with the selected variant and routes through its per-run gateway", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-runner-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const capture = join(dir, "command.json");
    writeFileSync(join(bin, "opencode"), `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
if (process.argv[2] === 'session') {
  process.stdout.write(JSON.stringify({ info: { location: { directory: process.env.PWD } } }));
  process.exit(0);
}
if (process.env.OPENCODE_API_KEY === 'preflight-no-network') {
  process.stdout.write(JSON.stringify({ sessionID: 'ses_preflight' }) + '\\n');
  process.exit(0);
}
writeFileSync(process.env.BENCH_CAPTURE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), pwd: process.env.PWD, config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) }));
`, { mode: 0o755 });
    const out = join(dir, "results");
    const result = spawnSync(process.execPath, ["run.mjs", "--agent", "opencode", "--model", "opencode/glm-5.3-flash#high", "--tasks", "chess-bugfix", "--modes", "off", "--out", out], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PWD: dir, PATH: `${bin}:${process.env.PATH}`, BENCH_CAPTURE: capture },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, "runs.jsonl"), "utf8")).exitCode, 0, readFileSync(join(out, "chess-bugfix.off.1", "agent.log"), "utf8"));
    const { args, cwd, pwd, config } = JSON.parse(readFileSync(capture, "utf8"));
    assert.deepEqual(args.slice(0, 6), ["run", "--standalone", "--auto", "--format", "json", "--model"]);
    assert.equal(args[6], "opencode/glm-5.3-flash#high");
    assert.match(cwd, /\/workspace$/);
    assert.equal(pwd.replace(/^\/private(?=\/var\/)/, ""), cwd.replace(/^\/private(?=\/var\/)/, ""), "OpenCode v2 selects the project from PWD, not the spawned process cwd");
    assert.equal(config.providers.opencode.settings.baseURL, "http://127.0.0.1:8890/v1");
    assert.equal(config.model, "opencode/glm-5.3-flash");
    assert.deepEqual(config.plugins, ["-*", "opencode.agent", "opencode.models.dev", "opencode.config.provider", "opencode.provider.opencode", "opencode.tool.patch", "opencode.tool.edit", "opencode.tool.glob", "opencode.tool.grep", "opencode.tool.read", "opencode.tool.shell", "opencode.tool.write"]);
    assert.equal(JSON.parse(readFileSync(join(out, "runs.jsonl"), "utf8")).agentModel, "opencode/glm-5.3-flash#high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed OpenCode location check stops before starting the gateway or agent", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-location-fail-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "opencode"), `#!/usr/bin/env node
if (process.argv[2] === 'session') process.stdout.write(JSON.stringify({ info: { location: { directory: '/wrong/repository' } } }));
else process.stdout.write(JSON.stringify({ sessionID: 'ses_preflight' }) + '\\n');
`, { mode: 0o755 });
    const out = join(dir, "results");
    const result = spawnSync(process.execPath, ["run.mjs", "--agent", "opencode", "--model", "opencode/glm-5.3-flash#high", "--tasks", "chess-bugfix", "--modes", "off", "--out", out], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PWD: dir, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8", timeout: 15_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /OpenCode isolation preflight failed/);
    assert.equal(existsSync(join(out, "chess-bugfix.off.1", "agent.log")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the runner confirms OpenCode's real session location before a paid run", (t) => {
  if (spawnSync("opencode", ["--version"], { encoding: "utf8" }).status !== 0) return t.skip("OpenCode CLI not installed");
  const dir = mkdtempSync(join(tmpdir(), "opencode-location-test-"));
  try {
    const out = join(dir, "results");
    const result = spawnSync(process.execPath, ["run.mjs", "--agent", "opencode", "--model", "opencode/glm-5.3-flash#high", "--tasks", "chess-bugfix", "--modes", "off", "--out", out, "--preflight-only"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PWD: dir },
      encoding: "utf8",
      timeout: 35_000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /OpenCode session location confirmed/);
    assert.equal(existsSync(join(out, "runs.jsonl")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("routing on accepts an OpenRouter Jev key without a TypeSafe key", () => {
  const result = spawnSync(process.execPath, ["run.mjs", "--agent", "fake", "--tasks", "chess-bugfix", "--modes", "on", "--port", "not-a-port"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, JEV_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.match(result.stderr, /gateway did not start/);
  assert.doesNotMatch(result.stderr, /TYPESAFE_API_KEY is not set/);
});

test("OpenCode v2 suppresses external plugins without removing its built-in agent", (t) => {
  if (spawnSync("opencode", ["--version"], { encoding: "utf8" }).status !== 0) return t.skip("OpenCode CLI not installed");
  const dir = mkdtempSync(join(tmpdir(), "opencode-plugin-test-"));
  try {
    const plugin = join(dir, "probe");
    const marker = join(dir, "loaded");
    mkdirSync(plugin);
    writeFileSync(join(plugin, "package.json"), '{"type":"module"}');
    writeFileSync(join(plugin, "index.js"), `import { writeFileSync } from 'node:fs';
export default { id: 'opencode.external', setup() { writeFileSync(${JSON.stringify(marker)}, 'loaded'); } };
`);
    const config = {
      model: "opencode/glm-5.3-flash",
      plugins: [plugin, "-*", "opencode.agent", "opencode.models.dev", "opencode.config.provider", "opencode.provider.opencode", "opencode.tool.patch", "opencode.tool.edit", "opencode.tool.glob", "opencode.tool.grep", "opencode.tool.read", "opencode.tool.shell", "opencode.tool.write"],
      providers: { opencode: { settings: { baseURL: "http://127.0.0.1:1/v1" } } },
    };
    const result = spawnSync("opencode", ["run", "--standalone", "--auto", "--format", "json", "--model", "opencode/glm-5.3-flash#high", "Say OK."], {
      cwd: dir,
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_API_KEY: "local-test-key" },
      encoding: "utf8",
      timeout: 12_000,
    });
    assert.match(result.stdout, /"type":"step_start"/, result.stderr);
    assert.doesNotMatch(result.stdout, /Agent not found/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
