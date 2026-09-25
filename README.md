# jev-gateway-bench

Does routing tool choices through Jev make a coding agent cheaper without making it worse?

This is the benchmark for [jev-gateway](https://github.com/vinilana/jev-gateway). It gives a real
coding agent (Codex, Claude Code or OpenCode) the same task twice, once with Jev routing on and once
with it off, meters every token through the gateway, and scores the result with a verifier the agent
never sees.

## Results

Six models, two tasks, five runs per mode: 120 agent sessions (2026-09-18 and 19). GPT models ran
in Codex 0.154 on a ChatGPT subscription, Claude models in Claude Code 2.1 on a claude.ai
subscription, with real Jev (`jev-latest`) and the gateway's default thresholds. Every agent ran
clean: no MCP servers, plugins, skills or personal settings, only its built-in coding tools.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="charts/comparison-dark.svg">
  <img alt="Input tokens, output tokens, LLM requests, seconds and checks passed, with Jev routing on and off, for six models on two chess tasks" src="charts/comparison-light.svg">
</picture>

Medians of the runs with routing on. The percentage compares them with the same model's runs
without routing.

### chess-bugfix: find and fix five injected bugs

| Model | Solved, on / off | Output tokens | Input tokens | LLM requests | Seconds | Jev steered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Astra | 5/5 · 5/5 | 1,226 (-57%) | 96k (-7%) | 5 (0%) | 41 (-39%) | 100% |
| GPT-5.6 Sol | 5/5 · 5/5 | 3,211 (-57%) | 202k (-40%) | 9 (-36%) | 78 (-36%) | 93% |
| GPT-5.6 Luna | 1/4 · 0/5 | 10,519 (-12%) | 506k (-10%) | 19.5 (-15%) | 200 (+10%) | 86% |
| Fable 5.1 | 5/5 · 5/5 | 8,675 (-13%) | 276k (-19%) | 14 (-22%) | 148 (+6%) | 45% |
| Opus 5 | 5/5 · 5/5 | 16,693 (-7%) | 406k (-22%) | 18 (-14%) | 218 (+2%) | 38% |
| Sonnet 5 | 5/5 · 5/5 | 16,623 (-41%) | 616k (-48%) | 26 (-26%) | 243 (-25%) | 34% |

### chess-san: add algebraic notation to a working engine

| Model | Solved, on / off | Output tokens | Input tokens | LLM requests | Seconds | Jev steered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GPT-6 Astra | 5/5 · 5/5 | 3,663 (0%) | 143k (+2%) | 7 (0%) | 88 (+8%) | 95% |
| GPT-5.6 Sol | 5/5 · 5/5 | 5,096 (-9%) | 147k (-39%) | 7 (-36%) | 78 (-16%) | 86% |
| GPT-5.6 Luna | 3/5 · 5/5 | 6,809 (-14%) | 315k (-51%) | 14 (-42%) | 121 (-14%) | 76% |
| Fable 5.1 | 5/5 · 5/5 | 13,497 (-24%) | 331k (-27%) | 13 (-19%) | 167 (-26%) | 51% |
| Opus 5 | 5/5 · 5/5 | 20,152 (+22%) | 676k (+61%) | 25 (+47%) | 390 (+83%) | 44% |
| Sonnet 5 | 5/5 · 5/5 | 23,487 (+9%) | 991k (+16%) | 32 (+3%) | 327 (+37%) | 42% |

### Opus 5 across harnesses

A separate series ran OpenCode 1.18.32 with `cli_proxy/claude-opus-5` against the same two tasks,
five runs per mode. The LLM went through a local CLI Proxy API; Jev used OpenRouter
(`typesafe/jev-1.13`). The gateway was `jev-gateway` 0.4.3. All 20 runs passed every hidden check
and the tool-call audit found no foreign reads. See the [raw runs and per-run checks](results/2026-09-23-opencode-opus-5-cliproxy-comparison/)
    and the [on/off summary](results/2026-09-23-opencode-opus-5-cliproxy-comparison/summary.md).

| Task / harness | Output tokens on / off | Input tokens on / off | Requests on / off | Seconds on / off | Solved on / off |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bugfix / Claude Code | 16,693 / 17,876 | 405,881 / 523,359 | 18 / 21 | 218 / 214 | 5/5 / 5/5 |
| Bugfix / OpenCode | 9,010 / 23,807 | 542,756 / 800,493 | 13 / 18 | 130 / 623 | 5/5 / 5/5 |
| SAN / Claude Code | 20,152 / 16,529 | 676,113 / 419,985 | 25 / 17 | 390 / 213 | 5/5 / 5/5 |
| SAN / OpenCode | 19,972 / 28,235 | 1,242,986 / 1,302,382 | 25 / 26 | 291 / 422 | 5/5 / 5/5 |

These are medians, not matched pairs of runs across harnesses. On SAN, routing increased Claude
Code's output tokens by 22% and time by 83%, but reduced OpenCode's by 29% and 31%. Without
routing, OpenCode took 422 seconds against Claude Code's 213. This is evidence that the effect
depends on the harness and transport, not that one harness caused the old result: Claude Code
used hints on Anthropic Messages and a claude.ai subscription, while OpenCode used forced tools
on Chat Completions through a local proxy. The gateway version, Jev provider/model, tool roster,
model transport and run date also differed. In OpenCode's bugfix baseline one LLM request failed;
all five runs still passed. Five repetitions per cell remain a small sample. Earlier OpenCode
pilots using OpenCode Zen (model disabled) and OpenRouter (credit failures, and one contaminated
run) are excluded from this series.

What the original six-model series says, and what it does not:

- **Debugging is where routing pays.** On `chess-bugfix` every model used fewer tokens with
  routing, from a little (Opus 5, Luna) to a lot (GPT-6 Astra and GPT-5.6 Sol cut output tokens by
  57%, Sonnet 5 cut input tokens by 48%). Nothing got less correct.
- **Writing a feature is a coin toss.** On `chess-san` routing helped GPT-5.6 Sol, GPT-5.6 Luna and
  Fable 5.1, did nothing for GPT-6 Astra, and made Opus 5 and Sonnet 5 clearly worse: Opus 5 needed
  47% more requests and 83% more time. The gateway only hints with Claude models, so a hint that
  does not fit costs a detour instead of being ignored for free.
- **Routing can cost correctness.** GPT-5.6 Luna solved `chess-san` five times out of five on its
  own and three out of five with routing, failing the same check both times. It used half the
  input tokens doing so. Cheaper and wrong is not a saving. It is one model and two runs, but it is
  the failure this benchmark exists to catch.
- **A weak model stays weak.** Luna could not reliably fix `chess-bugfix` either way (1 of 4 with
  routing, 0 of 5 without): it kept missing the castling bug. Routing does not add ability.
- **Codex takes more steering than Claude Code.** Jev decided 76 to 100% of Codex requests, where
  the gateway forces the tool, and 34 to 51% of Claude Code requests, where it can only hint.
- **One run was thrown out.** A GPT-5.6 Luna run, stuck on a bug, searched the disk, found the
  workspace of a Claude Code run that was going on at the same time, and compared notes. The audit
  below caught it and it is excluded from every number here. See "Could the agents have cheated?".
- **Five runs is a small sample.** The dots in the chart show how much runs vary; several of the
  differences above sit inside that spread. Everything ran on one machine over two days. Input
  tokens are mostly cached (80 to 96%), so an input saving is worth less money than the same saving
  in output tokens. Jev itself cost between half a cent and ten cents per five runs.

Raw data is in [results/](results/): `runs.jsonl` and `summary.md` per series, and for every run
the verifier's output, the size of the agent's change, and the gateway's per-request metadata.
Agent transcripts are not published. The two folders with `chess-bugfix` alone are earlier
single-run trials made with a personal set of MCP tools installed; they are kept for the record
and are not comparable with the clean runs above.

Redraw the chart with `npm run chart -- results/2026-09-18-c*-*`, and re-run the audit over
finished results with `node audit.mjs <results dir>`.

## Run it yourself

You need Node.js 22.15 or newer, a Jev key for your chosen provider (TypeSafe, OpenRouter or
Vercel AI Gateway) in `~/.jev-gateway/.env` (see the
[gateway's quick start](https://github.com/vinilana/jev-gateway#quick-start)), and Codex, Claude
Code and/or OpenCode installed and logged in.

```bash
git clone https://github.com/vinilana/jev-gateway-bench.git
cd jev-gateway-bench
npm install

npm run selftest                                     # prove the tasks measure what they claim (no agent, ~20 s)
npm run bench -- --list                              # tasks and options
npm run bench -- --agent codex --tasks chess-bugfix  # one run with routing on, one with it off
npm run bench -- --agent codex --reps 5 --prices 1.25,0.125,10
npm run bench -- --agent claude --model claude-fable-5-1 --reps 5
BENCH_OPENCODE_UPSTREAM=http://127.0.0.1:8317/v1 npm run bench -- --agent opencode --model cli_proxy/claude-opus-5 --tasks chess-bugfix,chess-san --reps 5
```

Codex and Claude Code run clean by default: no MCP servers, plugins, skills or personal settings.
Add `--user-tools` to measure your own setup instead. It changes the picture a lot: one setup here
sent 285 tools and about 200,000 tokens with every Claude Code request, against 6 tools and 7,000
tokens clean. OpenCode v2 runs with `--standalone --auto` in the task workspace. It uses a private
server and disables external plugins, as `--pure` did in v1, while retaining built-in OpenCode
plugins needed for its agent and tools. It still loads configured providers and other personal
settings; its runs are not equivalent to the clean-agent condition of the original six-model series.

OpenCode v2 requires `--model provider/model` (or `provider/model#variant` for an explicit effort
variant). Its selected provider must exist in your OpenCode config with a working credential. Set
`BENCH_OPENCODE_UPSTREAM` to that provider's real API base
URL (the default is OpenCode Zen). The runner moves only the selected provider's `baseURL` to its
isolated gateway for that process and passes the variant on the CLI, not in the root model setting.
It does not write your OpenCode config. Use a dedicated credential if you want to compare the same
provider account across machines; the published
OpenCode series used a locally configured CLI Proxy API.

For OpenCode v2, the runner sets `PWD` to the task workspace as well as starting the process there.
The CLI uses `PWD` to choose its project; `cwd` alone is not enough. Before each paid session, a
no-network preflight creates a session with the installed CLI and checks its exported location. A
missing session or a location outside the workspace stops the series before the gateway or agent
starts. Check this without running an eval:

```bash
node run.mjs --agent opencode --model opencode/glm-5.3-flash#high --tasks chess-bugfix --modes off --preflight-only
```

The isolation test passed with the installed CLI, and the runner's five OpenCode tests passed. This
only validates session location and the fail-stop guard; it is not a `high` or `max` eval. The earlier
GLM 5.3 Flash `high` and interrupted `max` runs used the wrong project and are excluded from any
comparison. They have not been rerun after this correction.

**Real agents spend real quota.** Every run is a full agent session. Start with one task and
`--reps 1`, look at the numbers, and scale up from there.

## How a run works

1. A fresh workspace is created in a temp directory from the task's starting files and committed to
   a git repository of its own.
2. A fresh gateway is started just for this run, on its own port (`--port`, default 8890), with
   routing on or off. Gateways you use every day are not touched, and nothing another session does
   can leak into the numbers.
3. The agent is started unattended inside the workspace, pointed at that gateway exactly the way
   the launchers do it, with edits and test runs allowed. It gets the task prompt
   and a time limit.
4. The gateway's own metering gives the totals for the run: LLM requests, input tokens (and how
   many were cached), output tokens (and how many were reasoning), Jev calls and tokens, and how
   each request was handled.
5. A hidden verifier scores the workspace.

Modes alternate within a repetition and swap order between repetitions, so neither one always goes
first.

Results land in `results/<timestamp>/`: `runs.jsonl` (one line per run), `summary.md`, and per run
the agent's output, the gateway log, the verifier's output and a diff summary. Rebuild a summary
any time with `npm run report -- <dir> [--prices in,cached,out]`.

## Reading the summary

- **Solved** means every hidden check passed. A cheaper run that is not solved is not a saving.
- **Cost per solved task** divides everything spent, failed runs included, by the runs that were
  solved. It needs `--prices` (USD per million input, cached input and output tokens for your
  model) and adds Jev's own cost. This is the number to decide on.
- **Requests Jev steered** is the share of LLM requests that were not plain passthrough. If it is
  low, routing had little chance to matter: the gateway's dashboard explains why.
- **Failed LLM requests** and **agent timeouts** catch the expensive failure: a wrongly forced tool
  can derail a turn, and one derailment can cost more than many routed turns save.
- With fewer than five runs per mode the summary says so.

## The chess tasks

All three are about one chess rules engine with a small, exact API
([SPEC.md](tasks/chess/SPEC.md)). Chess was chosen because it has an unusually objective
yardstick: **perft**, the number of move sequences of a given length from a position. The counts
are published, and one wrong rule anywhere (en passant, castling, pins, promotion) changes them.
The verifier runs perft through the public API on six standard positions, plus targeted checks for
FEN handling, draws and game endings.

| Task | The agent has to | Kind of work |
| --- | --- | --- |
| `chess-engine` | Build the whole engine from the spec | Long generation, many test runs |
| `chess-bugfix` | Find and fix five injected bugs, with failing perft tests as the only clue | Exploration and debugging |
| `chess-san` | Add algebraic notation (`san`, `moveSan`, `history`) to a working engine | A focused feature |

They differ on purpose. Routing may pay off on the mechanical middle turns of one kind of task and
not on another, and an average over one kind of work would hide that.

`tasks/chess/reference/chess.js` is a complete solution. It never reaches a workspace: it exists to
prove the verifier right, and the bugfix and SAN tasks are generated from it. `npm run selftest`
checks that the reference passes every check, that no starting workspace already passes, and that
each injected bug is caught on its own.

One caveat: this repository is public, so an agent with web access could in principle find the
reference. The agents work in a temp directory, are never told it exists, and the tasks give them
no reason to go looking.

## Could the agents have cheated?

A benchmark of agents has an obvious hole: an agent that finds an earlier run's workspace, a
scratch file, or this repository's reference solution is not solving the task. Agents run on the
same machine as the benchmark, Codex's sandbox can read the whole disk, and Claude Code is allowed
`cat` and `ls`, so nothing stops them from looking. What the benchmark does about it:

- **Every run gets a private directory** holding its workspace and its own temp directory
  (`TMPDIR`), which is deleted when the run ends, also when the benchmark is interrupted. Anything a
  dead benchmark left behind is removed before the next one starts.
- **Every run is audited.** Each agent keeps a record of the commands and tool calls it made. The
  runner reads it back and stores, in `runs.jsonl` under `isolation`, every path outside the run's
  directory and whether the run created it or found it. A run that read something it did not create
  is flagged on the console.
- Agents run without web tools or network by default, so the public copy of the reference is out of
  reach.
- **The agents' own harnesses are told to keep nothing.** Codex runs with `--ephemeral` and Claude
  Code with `--no-session-persistence`, so no session is saved that a later run could resume or be
  reminded of, and neither loads personal settings, plugins or skills. The audit reads the agent's
  output instead of files in its home directory.

Two gaps remain. An agent told to use a private temp directory may still write `/tmp/check.mjs` by
name, as Claude Code likes to; the runner cannot stop that, only notice when another run reads it.
And agents can read the whole disk: only a container or a separate user account would change that.
Until then the protection is detection, not prevention.

- **One series at a time.** The runner refuses to start while another benchmark is running,
  because a second series puts a live workspace for the same task within reach.
- **A run that read anything it did not create is excluded** from every statistic and named in the
  summary. Looking for `AGENTS.md` instruction files, which Codex does on its own, does not count.

That last rule comes from experience. Of the 120 published runs, 119 kept to themselves and one
did not. GPT-5.6 Luna, unable to get one perft number right, ran
`rg -n "kiwipete|2039|perft" /tmp /home/…`, found a test script that a Claude Code run had written
to `/tmp` and that run's workspace (two series were running side by side, which the runner no
longer allows), diffed the other agent's `chess.js` against its own, and then passed every check.
It is `chess-bugfix.on.3` in the Luna series, marked `contaminated` in `runs.jsonl`.

The rest of the audit, over 2,000 commands and tool calls:

- No other run opened another run's workspace or files, and no run opened the reference solution.
- Many Claude Code runs wrote test scripts of their own into the shared `/tmp`, such as
  `/tmp/check.mjs`, ignoring the private temp directory they were given. Each created its copy
  before using it. These are the files the Luna run found.
- Codex runs looked for an `AGENTS.md` next to their workspace, and one searched the home directory
  for files of that name. That is Codex looking for instructions, not for answers.
- Neither harness carried anything over. Codex's `memories` feature was off and its store empty.
  Claude Code keeps memory and transcripts per working directory, every run had a directory of its
  own, and the memory folders it created for them are all empty. The first 40 runs saved session
  transcripts, which nothing reads unless a session is resumed, and no run resumed one. The Fable
  5.1 series was audited from those transcripts, the others from the agents' own output.

What no audit can rule out is what the models already know: chess rules, perft numbers and
algebraic notation are all over their training data. That lifts both columns equally. It is a
reason not to read these tasks as a measure of how good the agents are, only of what routing
changes.

## Testing the benchmark without an agent

`--agent fake` replaces the agent with a script that sends a few requests through the gateway and
then writes the reference solution. Together with the fake provider and the gateway's mock Jev, the
whole pipeline runs in seconds and costs nothing:

```bash
node dev/fake-upstream.mjs &
MOCK_JEV_SCRIPT=exec_command node node_modules/jev-gateway/scripts/mock-jev.mjs &
TYPESAFE_API_KEY=mock TYPESAFE_BASE_URL=http://127.0.0.1:8799 npm run bench -- --agent fake --reps 2
```

## Adding a task

A task is an object with an `id`, a `title`, a `prompt`, a `timeoutMinutes`, a `setup(workspace)`
that writes the starting files, and a `verify(workspace)` that returns the command line of a
verifier. The verifier prints `{"total": n}` and then one `{"name", "ok"}` JSON line per check, as
it goes, so a solution that hangs keeps the credit it earned before the timeout. Add the task to
`TASKS` in `run.mjs`.

## License

MIT
