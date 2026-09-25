#!/usr/bin/env node
// Benchmark runner: the same coding task, done by a real agent, with Jev routing on and off.
//
//   node run.mjs --agent codex --tasks chess-bugfix --reps 3
//
// Every run gets a fresh workspace and a fresh gateway of its own, so the tokens the gateway
// meters belong to that run and nothing else. When the agent stops, a hidden verifier scores what
// it left behind: cheaper only counts if the work is still right.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { claude, codex } from "jev-gateway/bin/clients.mjs";
import { GATEWAY_ARGS, ROOT, loadEnv } from "jev-gateway/bin/launcher.mjs";
import { PROVIDERS, resolveProvider } from "jev-gateway/dist/jev.js";
import { audit } from "./audit.mjs";
import { summarize } from "./report.mjs";
import { tasks as chessTasks } from "./tasks/chess/tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS = [...chessTasks];

// How each agent is run unattended, inside the workspace, with edits and test runs allowed.
// By default an agent runs clean: no MCP servers, plugins, skills or personal settings, only its
// built-in coding tools. Whatever the person running the benchmark has installed would otherwise
// change the tool roster (one setup here sent 285 tools and 200k tokens per request), and the
// results would describe that setup instead of the agent. --user-tools keeps it all.
const AGENTS = {
  opencode: {
    spec: { upstream: () => process.env.BENCH_OPENCODE_UPSTREAM ?? "https://opencode.ai/zen/v1" },
    command: (origin, workspace, prompt) => ({
      file: "opencode",
      args: ["run", "--standalone", "--auto", "--format", "json", "--model", options.model, prompt],
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: options.model.split("#")[0],
          plugins: ["-*", "opencode.agent", "opencode.models.dev", "opencode.config.provider", "opencode.provider.opencode", "opencode.tool.patch", "opencode.tool.edit", "opencode.tool.glob", "opencode.tool.grep", "opencode.tool.read", "opencode.tool.shell", "opencode.tool.write"],
          providers: {
            [options.model.split("/")[0]]: { settings: { baseURL: `${origin}/v1` } },
          },
        }),
        OPENCODE_EXPERIMENTAL_NATIVE_LLM: "false",
        OPENCODE_EXPERIMENTAL_CODE_MODE: "false",
      },
    }),
  },
  codex: {
    spec: codex,
    command: (origin, workspace, prompt) => ({
      file: "codex",
      args: [...codex.args(origin), ...(options["user-tools"] ? [] : ["-c", "mcp_servers={}", "-c", "plugins={}"]), "exec", "--ephemeral", ...(options.model ? ["-m", options.model] : []), "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", workspace, prompt],
    }),
  },
  claude: {
    spec: claude,
    command: (origin, _workspace, prompt) => ({
      file: "claude",
      args: [
        "-p", prompt,
        // Every tool call goes to the log (the audit reads it), and nothing is saved for a later session.
        "--output-format", "stream-json", "--verbose", "--no-session-persistence",
        ...(options.model ? ["--model", options.model] : []),
        ...(options["user-tools"] ? [] : ["--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--tools", "Bash,Edit,Write,Read,Glob,Grep"]),
        "--permission-mode", "acceptEdits",
        "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(node:*)", "Bash(npm test:*)", "Bash(npm run:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(git diff:*)", "Bash(git status:*)",
      ],
      env: claude.env(origin),
    }),
  },
  // Exercises the whole pipeline without an LLM: see dev/fake-agent.mjs.
  fake: {
    spec: { upstream: () => process.env.BENCH_FAKE_UPSTREAM ?? "http://127.0.0.1:8798/v1" },
    command: (origin, workspace, _prompt, task) => ({
      file: process.execPath,
      args: [join(HERE, "dev/fake-agent.mjs"), origin, workspace, task.id],
    }),
  },
};

const { values: options } = parseArgs({
  options: {
    agent: { type: "string", default: "codex" },
    model: { type: "string" },
    "user-tools": { type: "boolean", default: false },
    tasks: { type: "string", default: TASKS.map((task) => task.id).join(",") },
    modes: { type: "string", default: "on,off" },
    reps: { type: "string", default: "1" },
    port: { type: "string", default: "8890" },
    out: { type: "string" },
    "timeout-min": { type: "string" },
    prices: { type: "string" },
    keep: { type: "boolean", default: false },
    "preflight-only": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (options.help || options.list) {
  console.log(`Usage: node run.mjs [options]

  --agent codex|claude|opencode|fake   which agent does the work (default codex)
  --model NAME                model for the agent (required for opencode)
  --user-tools                keep your own MCP servers, plugins, skills and settings (default: run the agent clean)
  --tasks a,b                 task ids (default: all)
  --modes on,off              routing states to compare (default on,off)
  --reps N                    repetitions of every task in every mode (default 1)
  --timeout-min N             override each task's own time limit
  --prices in,cached,out      USD per million tokens, to report cost as well as tokens
  --port N                    port for the per-run gateway (default 8890)
  --out DIR                   where results go (default results/<timestamp>)
  --keep                      keep the workspaces for inspection
  --preflight-only            check OpenCode's session location without a paid request

Tasks:
${TASKS.map((task) => `  ${task.id.padEnd(14)} ${task.title} (${task.timeoutMinutes} min)`).join("\n")}

Real agents spend real quota: every run is a full agent session. Start with one task and --reps 1.`);
  process.exit(0);
}

const agent = AGENTS[options.agent];
if (!agent) throw new Error(`Unknown agent "${options.agent}". Use one of: ${Object.keys(AGENTS).join(", ")}`);
if (options.agent === "opencode" && !options.model?.includes("/")) throw new Error("--agent opencode needs --model provider/model");
const chosen = options.tasks.split(",").map((id) => {
  const task = TASKS.find((candidate) => candidate.id === id.trim());
  if (!task) throw new Error(`Unknown task "${id}". Run with --list to see them.`);
  return task;
});
const modes = options.modes.split(",").map((mode) => mode.trim());
if (modes.some((mode) => mode !== "on" && mode !== "off")) throw new Error("--modes takes on, off, or on,off");
const reps = Number(options.reps);
const port = Number(options.port);
const origin = `http://127.0.0.1:${port}`;
const outDir = resolve(options.out ?? join(HERE, "results", new Date().toISOString().replace(/[:.]/g, "-")));

loadEnv();
const jevKey = PROVIDERS[resolveProvider(process.env)].keyEnv;
if (!process.env[jevKey] && modes.includes("on")) {
  throw new Error(`${jevKey} is not set, so routing could never be on. Set it, or run with --modes off.`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Run a process to its end or to a deadline; its whole process group dies with the deadline. */
function run(file, args, { cwd, env, logFile, timeoutMs, onLine }) {
  return new Promise((done) => {
    const startedAt = Date.now();
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const log = logFile ? createWriteStream(logFile) : undefined;
    let pending = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      log?.write(chunk);
      if (!onLine) return;
      const lines = (pending + chunk).split("\n");
      pending = lines.pop();
      lines.forEach(onLine);
    });
    child.stderr.on("data", (chunk) => log?.write(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    const finish = (exitCode) => {
      clearTimeout(timer);
      if (pending && onLine) onLine(pending);
      log?.end();
      done({ exitCode, timedOut, seconds: (Date.now() - startedAt) / 1000 });
    };
    child.on("error", () => finish(127));
    child.on("exit", (code) => finish(code));
  });
}

async function checkOpenCodeLocation(workspace, scratch) {
  const db = join(scratch, "opencode-preflight.db");
  const config = JSON.stringify({
    model: options.model.split("#")[0],
    plugins: ["-*", "opencode.agent", "opencode.models.dev", "opencode.config.provider", "opencode.provider.opencode", "opencode.tool.patch", "opencode.tool.edit", "opencode.tool.glob", "opencode.tool.grep", "opencode.tool.read", "opencode.tool.shell", "opencode.tool.write"],
    providers: { [options.model.split("/")[0]]: { settings: { baseURL: "http://127.0.0.1:1/v1" } } },
  });
  const env = { PWD: workspace, TMPDIR: scratch, OPENCODE_DB: db, OPENCODE_API_KEY: "preflight-no-network", OPENCODE_CONFIG_CONTENT: config };
  let sessionID;
  await run("opencode", ["run", "--standalone", "--auto", "--format", "json", "--model", options.model, "Say OK."], {
    cwd: workspace, env, timeoutMs: 9_000,
    onLine: (line) => { try { sessionID ??= JSON.parse(line).sessionID; } catch {} },
  });
  if (!sessionID) throw new Error("OpenCode isolation preflight failed: no session was created; stopping series");
  let exported = "";
  const outcome = await run("opencode", ["session", "export", "--standalone", sessionID], {
    cwd: workspace, env, timeoutMs: 9_000, onLine: (line) => { exported += line + "\n"; },
  });
  const directory = outcome.exitCode === 0 ? JSON.parse(exported).info?.location?.directory : undefined;
  const canonical = (path) => path?.replace(/^\/private(?=\/var\/)/, "");
  if (!directory || canonical(directory) !== canonical(workspace)) {
    throw new Error(`OpenCode isolation preflight failed: session directory ${JSON.stringify(directory)} is not ${workspace}; stopping series`);
  }
  console.log(`OpenCode session location confirmed: ${directory}`);
}

async function startGateway(mode, logFile) {
  // The agent authenticates itself (subscription login or its own key); the gateway must not swap that out.
  const { UPSTREAM_API_KEY: _key, ROUTER_API_KEY: _routerKey, JEV_LOG_FILE: _log, ...env } = process.env;
  const log = createWriteStream(logFile);
  const child = spawn(process.execPath, GATEWAY_ARGS, {
    cwd: ROOT,
    env: { ...env, PORT: String(port), UPSTREAM_BASE_URL: agent.spec.upstream(), JEV_ROUTING: mode, JEV_CLIENT: "bench" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const health = await (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })).json();
      if (health.pid === child.pid) return child;
      throw new Error(`port ${port} is already serving another gateway (pid ${health.pid}); pick another --port`);
    } catch (error) {
      if (String(error.message).includes("another gateway")) throw error;
      await sleep(100);
    }
  }
  child.kill();
  throw new Error(`the gateway did not start; see ${logFile}`);
}

/** Everything the gateway metered during the run, reduced to totals. */
async function meter() {
  // Requests are logged when their reply ends; give the last one a moment to land.
  await sleep(1500);
  const { events } = await (await fetch(`${origin}/dashboard/events`)).json();
  const sum = (pick) => events.reduce((total, event) => total + (pick(event) ?? 0), 0);
  const modes = {};
  for (const event of events) modes[event.mode] = (modes[event.mode] ?? 0) + 1;
  return {
    requests: events.length,
    metered: events.filter((event) => event.usage).length,
    failedRequests: events.filter((event) => event.status !== undefined && event.status >= 400).length,
    input: sum((event) => event.usage?.input),
    cached: sum((event) => event.usage?.cached),
    cacheWrite: sum((event) => event.usage?.cacheWrite),
    output: sum((event) => event.usage?.output),
    reasoning: sum((event) => event.usage?.reasoning),
    llmSeconds: sum((event) => event.durationMs) / 1000,
    jevCalls: events.filter((event) => event.jev).length,
    jevInput: sum((event) => event.jev?.inputTokens),
    jevSeconds: sum((event) => event.jev?.latencyMs) / 1000,
    modes,
    models: [...new Set(events.map((event) => event.model).filter(Boolean))],
  };
}

async function verify(task, workspace, logFile) {
  let total = 0;
  const checks = [];
  const [script, ...args] = task.verify(workspace);
  const { timedOut } = await run(process.execPath, [script, ...args], {
    logFile,
    timeoutMs: 3 * 60_000,
    onLine: (line) => {
      try {
        const entry = JSON.parse(line);
        if (typeof entry.total === "number") total = entry.total;
        else if (entry.name) checks.push(entry);
      } catch {
        // A solution that prints to stdout while being verified.
      }
    },
  });
  const passed = checks.filter((entry) => entry.ok).length;
  return { passed, total, score: total ? passed / total : 0, solved: total > 0 && passed === total, timedOut, failed: checks.filter((entry) => !entry.ok).map((entry) => entry.name) };
}

// Anything an earlier, interrupted benchmark left in the temp directory is a finished or
// half-finished solution lying where the next agent could find it.
// Sandboxes carry their runner's pid, so a second benchmark running right now keeps its own.
const alive = (pid) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};
for (const name of readdirSync(tmpdir())) {
  const owner = Number(/^jev-bench-(\d+)-/.exec(name)?.[1]);
  if (name.startsWith("jev-bench-") && !(owner && alive(owner))) rmSync(join(tmpdir(), name), { recursive: true, force: true });
}
// One benchmark at a time. Agents can read the whole disk, so a second series running alongside
// puts a live workspace for the same task within reach, and an agent that gets stuck goes looking.
const lock = join(tmpdir(), "jev-bench.lock");
const holder = existsSync(lock) ? Number(readFileSync(lock, "utf8")) : undefined;
if (holder && holder !== process.pid && alive(holder)) {
  throw new Error(`another benchmark is running (pid ${holder}). Series must not overlap: agents can read each other's workspaces.`);
}
writeFileSync(lock, String(process.pid));
process.on("exit", () => rmSync(lock, { force: true }));

let sandbox;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (sandbox && !options.keep) rmSync(sandbox, { recursive: true, force: true });
    process.exit(130);
  });
}

mkdirSync(outDir, { recursive: true });
const runs = [];
const plan = [];
// Modes alternate within a repetition, and swap order between repetitions, so neither state always
// runs first (warm provider caches) or at the same time of day.
for (let rep = 1; rep <= reps; rep++) {
  for (const task of chosen) for (const mode of rep % 2 ? modes : [...modes].reverse()) plan.push({ task, mode, rep });
}
console.log(`${plan.length} run${plan.length === 1 ? "" : "s"} with ${options.agent}; results in ${outDir}\n`);

for (const [number, { task, mode, rep }] of plan.entries()) {
  const label = `${task.id}.${mode}.${rep}`;
  const runDir = join(outDir, label);
  mkdirSync(runDir, { recursive: true });
  // A private directory per run: the workspace, and next to it the run's own temp directory, so
  // the scratch files agents like to write never land where another run could read them.
  sandbox = mkdtempSync(join(tmpdir(), `jev-bench-${process.pid}-`));
  const workspace = join(sandbox, "workspace");
  const scratch = join(sandbox, "tmp");
  mkdirSync(workspace);
  mkdirSync(scratch);
  task.setup(workspace);
  // A repository of its own: agents expect one, and the diff shows what this run changed.
  await run("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: workspace, timeoutMs: 30_000 });
  await run("git", ["add", "-A"], { cwd: workspace, timeoutMs: 30_000 });
  await run("git", ["-c", "user.name=bench", "-c", "user.email=bench@localhost", "commit", "-q", "-m", "task"], { cwd: workspace, timeoutMs: 30_000 });

  if (options.agent === "opencode") await checkOpenCodeLocation(workspace, scratch);
  if (options["preflight-only"]) {
    if (!options.keep) rmSync(sandbox, { recursive: true, force: true });
    sandbox = undefined;
    break;
  }

  process.stdout.write(`[${number + 1}/${plan.length}] ${label} … `);
  const gateway = await startGateway(mode, join(runDir, "gateway.log"));
  let result;
  try {
    const { file, args, env } = agent.command(origin, workspace, task.prompt, task);
    const timeoutMs = Number(options["timeout-min"] ?? task.timeoutMinutes) * 60_000;
    const outcome = await run(file, args, { cwd: workspace, env: { ...env, ...(options.agent === "opencode" ? { PWD: workspace } : {}), TMPDIR: scratch }, logFile: join(runDir, "agent.log"), timeoutMs });
    const usage = await meter();
    result = { ...outcome, ...usage };
  } finally {
    gateway.kill();
  }
  const verdict = await verify(task, workspace, join(runDir, "verify.log"));
  await run("git", ["add", "-A"], { cwd: workspace, timeoutMs: 30_000 });
  await run("git", ["diff", "--cached", "--stat"], { cwd: workspace, logFile: join(runDir, "diff.stat"), timeoutMs: 30_000 });

  const isolation = audit({ agent: options.agent, agentLog: join(runDir, "agent.log"), workspace, sandbox });
  // Keep only request metadata. Agent transcripts and raw gateway logs stay ignored by git.
  const requests = readFileSync(join(runDir, "gateway.log"), "utf8").split("\n").flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry.event === "route" ? [entry] : [];
    } catch {
      return [];
    }
  });
  writeFileSync(join(runDir, "gateway-requests.jsonl"), requests.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const record = { task: task.id, agent: options.agent, agentModel: options.model, userTools: options["user-tools"], mode, rep, ...result, ...verdict, isolation, workspace: options.keep ? workspace : undefined };
  runs.push(record);
  writeFileSync(join(outDir, "runs.jsonl"), runs.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  if (!options.keep) rmSync(sandbox, { recursive: true, force: true });
  sandbox = undefined;
  console.log(
    `${verdict.passed}/${verdict.total} checks, ${record.requests} requests, ${record.input.toLocaleString("en-US")} in / ${record.output.toLocaleString("en-US")} out, ${Math.round(record.seconds)} s` +
      (record.timedOut ? " (agent timed out)" : "") +
      (isolation.contaminated ? ` (CONTAMINATED, excluded: read ${isolation.foreignReads.join(", ")})` : ""),
  );
}

const prices = options.prices?.split(",").map(Number);
const report = summarize(runs, prices && { input: prices[0], cached: prices[1], output: prices[2] });
writeFileSync(join(outDir, "summary.md"), report);
console.log("\n" + report);
