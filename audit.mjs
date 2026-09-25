// Did a run look at anything it should not have? A benchmark of agents has one obvious way to
// cheat: an earlier run's workspace, a scratch file another run left behind, or this repository's
// reference solution. Each agent keeps a record of what it did; this reads it back and lists every
// path outside the run's own sandbox, and whether the run created that path itself or found it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Places an agent may touch without it meaning anything: the toolchain and the system.
const HARMLESS = /^\/(usr|bin|etc|dev|proc|lib|opt|nix|snap)\b|\/\.nvm\/|\/node_modules\/|^\/home\/[^/]+\/\.(npm|cache|nvm|codex|claude)\b/;
const PATHS = /(?<![\w.:-])(~?\/(?:home|tmp|mnt|root|var|Users)\/[^\s"'`\\)<>|;,]*)/g;

function inspect(commands, sandbox) {
  // macOS resolves /var to /private/var in some processes; they name the same sandbox.
  const canonical = (path) => path.replace(/^\/private(?=\/var\/)/, "");
  const seen = new Map();
  for (const { tool, text } of commands) {
    // Codex looks for AGENTS.md instruction files around its workspace, sometimes far and wide.
    // That is a search for instructions by file name, not for anything about the task.
    if (/AGENTS\.md/.test(text) && !/\b(cat|sed|diff)\b[^|;&]*\/(?!.*AGENTS\.md)/.test(text)) continue;
    for (const [path] of text.matchAll(PATHS)) {
      if (canonical(path).startsWith(canonical(sandbox)) || HARMLESS.test(path) || seen.has(path)) continue;
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const created = tool === "Write" || new RegExp(`(>|tee\\s+(-a\\s+)?|mkdir\\s+(-p\\s+)?|touch\\s+)\\s*${escaped}`).test(text);
      seen.set(path, created ? "created" : "found");
    }
  }
  // Results get published: report the home directory as "~", not by the user's name.
  const outside = [...seen].map(([path, how]) => ({ path: path.startsWith(homedir()) ? "~" + path.slice(homedir().length) : path, how }));
  const foreignReads = outside.filter((entry) => entry.how === "found").map((entry) => entry.path);
  // A run that read anything it did not create is out: it may have seen another run's work.
  return { outside, foreignReads, contaminated: foreignReads.length > 0 };
}

/** Codex prints every command it runs into its own output. */
function codexCommands(agentLog) {
  const lines = readFileSync(agentLog, "utf8").split("\n");
  return lines.filter((line) => /^\/bin\/(ba)?sh -lc /.test(line)).map((text) => ({ tool: "shell", text }));
}

/** Claude Code, run with --output-format stream-json, prints every message, tool calls included. */
function claudeCommands(agentLog) {
  const commands = [];
  for (const line of readFileSync(agentLog, "utf8").split("\n")) {
    try {
      const content = JSON.parse(line).message?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "tool_use") commands.push({ tool: block.name, text: JSON.stringify(block.input) });
      }
    } catch {
      // Not a JSON line.
    }
  }
  return commands;
}

/** OpenCode's JSON event stream includes the tool and its input for each completed tool call. */
function opencodeCommands(agentLog) {
  const commands = [];
  for (const line of readFileSync(agentLog, "utf8").split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "tool_use" && entry.part?.state?.status === "completed") {
        commands.push({ tool: entry.part.tool, text: JSON.stringify(entry.part.state.input) });
      }
    } catch {
      // Not a JSON event.
    }
  }
  return commands;
}

export function audit({ agent, agentLog, sandbox }) {
  if (!existsSync(agentLog)) return { audited: false };
  const commands = agent === "codex" ? codexCommands(agentLog) : agent === "claude" ? claudeCommands(agentLog) : agent === "opencode" ? opencodeCommands(agentLog) : [];
  return { audited: true, toolCalls: commands.length, ...inspect(commands, sandbox) };
}

// node audit.mjs <results dir> …   re-audits finished runs from their agent logs and rewrites the
// `isolation` field of runs.jsonl, for results made before a rule existed or after one changed.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const dir of process.argv.slice(2)) {
    const file = join(dir, "runs.jsonl");
    const runs = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    for (const run of runs) {
      const agentLog = join(dir, `${run.task}.${run.mode}.${run.rep}`, "agent.log");
      if (!existsSync(agentLog)) continue;
      const log = readFileSync(agentLog, "utf8");
      // Where the agent worked: Codex prints it, Claude Code reports it in its first event.
      const workspace = /^workdir: (.+)$/m.exec(log)?.[1] ?? /"cwd":"([^"]+)"/.exec(log)?.[1];
      if (!workspace) continue;
      const sandbox = workspace.endsWith("/workspace") ? workspace.slice(0, -"/workspace".length) : workspace;
      run.isolation = audit({ agent: run.agent, agentLog, sandbox });
    }
    writeFileSync(file, runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
    const bad = runs.filter((run) => run.isolation?.contaminated);
    console.log(`${dir}: ${runs.filter((run) => run.isolation?.audited).length}/${runs.length} audited, ${bad.length} contaminated${bad.length ? ": " + bad.map((run) => `${run.task}.${run.mode}.${run.rep} -> ${run.isolation.foreignReads.join(" ")}`).join("; ") : ""}`);
  }
}
