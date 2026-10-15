<div align="center">
  <img src="docs/assets/openclaude-wordmark.png" alt="HüberClaude — a coding-agent CLI dedicated to OpenRouter" width="830">
</div>

HüberClaude is an open-source coding-agent CLI **dedicated to OpenRouter**.

One API key, thousands of models, one terminal-first workflow: prompts, tools,
agents, MCP, slash commands, and streaming output. On top of that, **Enxame
mode** (Portuguese for "swarm") hands small, mechanical sub-tasks to cheap z.ai
GLM flash workers so your main OpenRouter model spends its tokens only on
planning and hard reasoning.

HüberClaude is a fork of [OpenClaude](https://github.com/Gitlawb/openclaude).
Where OpenClaude supports many providers, HüberClaude does one thing:
it runs on OpenRouter, and it tries to spend as few tokens as possible.

[Why HüberClaude](#why-hüberclaude) | [Quick Start](#quick-start) | [OpenRouter](#openrouter) | [Enxame mode](#enxame-mode-save-tokens-with-a-swarm) | [Commands](#hüberclaude-commands) | [Development](#development)

## Why HüberClaude

- **OpenRouter only, no provider setup.** Run `/login`, paste your OpenRouter key, and you're done. You don't need provider profiles, base URLs to tune, or provider-specific behavior to learn.
- **Every model behind one key.** Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi, and the rest of the OpenRouter catalog, picked from `/model`.
- **Enxame mode to save tokens.** Your main model plans and decides. A swarm of up to 10 cheap z.ai workers handles bulk work like summarizing, extracting, classifying, and small scoped edits.
- **Spend you can see.** `/usage` shows your OpenRouter balance as a fuel gauge scaled to your last recharge.
- **A full coding agent.** Bash, file read/write/edit, grep, glob, sub-agents, tasks, MCP, skills, hooks, and web search.
- **Its own look.** A green, lizard-themed header with the block "H" mascot and a star spinner. The screen clears on start.

## Quick Start

### Install from source

HüberClaude needs Node.js `>=22.0.0` to run. Bun `1.3.13` or newer is used to build it.

```bash
git clone https://github.com/Leandrodasilvahuber/huberclaude.git
cd huberclaude
bun install
bun run build
npm install -g .
```

This puts a `huberclaude` binary on your `PATH`. If startup reports
`ripgrep not found`, install ripgrep system-wide and confirm `rg --version`
works in the same terminal.

### Start

```bash
cd your-repo
huberclaude
```

On first launch:

1. Run `/login` and paste your OpenRouter API key (get one at [openrouter.ai/keys](https://openrouter.ai/keys)).
2. Run `/model` to pick a model. The default is `qwen/qwen3-coder`.
3. Optional: run `/enxame` to register a z.ai key and turn on the swarm.

## OpenRouter

HüberClaude talks **only** to OpenRouter (`https://openrouter.ai/api/v1`).
It overrides any inherited `OPENAI_BASE_URL` or model, for example from a local
proxy, so a stray export can't send your traffic somewhere else.

| Command | What it does |
| --- | --- |
| `/login` | Save your OpenRouter API key (and an optional custom base URL) |
| `/model` | Browse the OpenRouter catalog and switch models mid-session |
| `/usage` | Show your OpenRouter balance and spend as a fuel gauge |

Your key is saved to `~/.openclaude/config.json` with owner-only (`0600`)
permissions. For CI or scripted runs, export it instead:

```bash
export HUBERCLAUDE_OPENROUTER_API_KEY=sk-or-...
huberclaude -p "explain this repo"
```

The generic `OPENROUTER_API_KEY` is ignored on purpose, so an unrelated export
can't silently switch your session's account.

For best results, pick models with strong tool and function calling.

## Enxame mode: save tokens with a swarm

The idea is simple. **Your expensive OpenRouter model is the manager, and z.ai
workers are the swarm.** The manager keeps planning, hard reasoning, and final
decisions. It fans out cheap, well-scoped work to fast GLM flash models
(`glm-4.7-flash`, falling back to `glm-4.5-flash`) and only reads back short,
structured results.

### Setup

```text
/enxame
```

Paste a z.ai API key, then use the menu to:

| Option | What it does |
| --- | --- |
| Enable / Disable swarm | Turn the swarm on or off without removing the key |
| Mode | Choose **Tool**, **Agent**, or **Both** (the default) |
| Workers | Set the maximum number of workers running at once (1–10, default 10) |
| Test connection | Send a quick request to check the key and model |
| Replace / Remove account | Change or delete the stored z.ai key |

### Modes

- **Tool (`Ferramenta`)**: the cheapest mode. The manager gets an `Enxame` tool that sends many **stateless** prompts in parallel. Each worker sees only the prompt it was given, with no history, files, or tools, and returns a short answer. Results come back as a JSON array of `{id, ok, text}`. This fits summarizing N snippets, extracting fields, classifying items, translating, or drafting boilerplate from pasted code.
- **Agent (`Agente`)**: the manager can launch `enxame-worker` sub-agents that run on z.ai **with tools**. They can read and search files, run a command, or make a small edit. Workers never spawn more agents and don't load project memory files, which keeps them lean.
- **Both (`Ambos`)**: both options are available, and the manager picks per task.

Requests are staggered to stay under z.ai rate limits. If a worker hits a `429`,
it backs off and retries, then falls back to the secondary model. Workers are
weaker models, so the manager is told to check their output before relying on
it. Never put secrets in a worker prompt.

## HüberClaude commands

On top of the standard agent commands (`/clear`, `/compact`, `/resume`,
`/rewind`, `/diff`, `/mcp`, `/agents`, `/permissions`, `/skills`, …):

| Command | Purpose |
| --- | --- |
| `/login` | Configure the OpenRouter API key and base URL |
| `/model` | Pick an OpenRouter model |
| `/usage` | OpenRouter balance and spend, shown as a fuel gauge |
| `/enxame` | Register the z.ai account and configure the swarm (on/off, mode, workers) |
| `/search` | Choose the web search backend (Exa by default) or add a search API key |
| `/buddy` | Hatch a pixel-art companion beside your prompt |

### Resume or fork a conversation

```bash
huberclaude --resume <session-id>
huberclaude --continue
huberclaude --continue --fork-session   # branch into a new session ID
```

Forking branches only the conversation. It does not copy your working tree or
create a git worktree.

### Background sessions

Run long non-interactive prompts detached from the current terminal:

```bash
huberclaude --bg "fix failing tests"
huberclaude --bg --name auth-refactor "refactor auth middleware"
huberclaude ps
huberclaude logs auth-refactor -f
huberclaude kill auth-refactor
```

Background sessions are local child processes, with no daemon and no network
service. Metadata and logs live under `~/.openclaude/bg-sessions/`. Set
`OPENCLAUDE_CONFIG_DIR` to move the config directory.

## Web Search and Fetch

[Exa](https://exa.ai) is the default web search backend. With no setup,
`WebSearch` uses Exa's keyless free tier, which has per-second and daily
limits. Use `/search` to pick a backend, add an API key, or run a test search.
Any backend you configure with a key (Tavily, Brave, Firecrawl, …) runs before
the Exa free tier, and DuckDuckGo is the last-resort fallback. Set
`EXA_FREE_TIER=0` if searches should never go to Exa without a key. See
[Web Search Providers](src/tools/WebSearchTool/README_SEARCH_PROVIDERS.md).

`WebFetch` uses plain HTTP plus HTML-to-markdown. Set `FIRECRAWL_API_KEY` to
fetch JavaScript-rendered pages through Firecrawl instead.

## Agents

Built-in and custom agents run on your OpenRouter model by default. You can
route specific agents to other OpenRouter models with `agentModels` and
`agentRouting` in `~/.openclaude/settings.json`, and cap sub-agent tool steps
with `maxSteps`. See [Agent Routing and Step Limits](docs/agent-routing.md).
The `enxame-worker` agent is routed to z.ai automatically when Enxame mode
allows agents.

## Development

Use Node.js `>=22.0.0` and Bun `1.3.13` or newer.

```bash
bun install
bun run build
node dist/cli.mjs
```

- `bun run dev`: build and launch from source
- `bun test`: full unit suite
- `bun test path/to/file.test.ts`: focused runs
- `bun run typecheck`: TypeScript check
- `bun run smoke`: smoke checks
- `bun run web:build`: build the documentation site in `web/`

See [CONTRIBUTING.md](CONTRIBUTING.md#validation) for the full pre-push
validation contract.

## Repository Structure

- `src/` - core CLI and runtime (`src/tools/EnxameTool/` and `src/utils/enxame*.ts` hold the swarm)
- `scripts/` - build, verification, and maintenance scripts
- `docs/` - setup and contributor documentation
- `web/` - documentation website
- `bin/` - CLI launcher entrypoints

## Security

If you believe you found a security issue, see [SECURITY.md](SECURITY.md).

## Disclaimer

HüberClaude is an independent fork of [OpenClaude](https://github.com/Gitlawb/openclaude).
It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenRouter, or Z.ai.

OpenClaude originated from the Claude Code codebase. "Claude" and "Claude Code"
are trademarks of Anthropic PBC. See [LICENSE](LICENSE) for details.

## License

MIT for contributors' modifications. The derived Claude Code remains Anthropic's. [See more](LICENSE).
