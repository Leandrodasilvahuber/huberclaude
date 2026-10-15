// Seeded from src/commands.ts, src/i18n/languages/en.ts, and per-command
// argumentHint fields in src/commands/*/index.ts in the CLI source.
// Hidden, ant-only, and feature-gated commands are intentionally excluded.

export type CommandCategory =
  | 'session'
  | 'context'
  | 'models'
  | 'workflow'
  | 'tools'
  | 'customization'
  | 'diagnostics'

export interface SlashCommand {
  name: string
  description: string
  category: CommandCategory
  /** argument hint, mirrors the CLI's autocomplete hint */
  args?: string
}

export const commandCategories: { id: CommandCategory; label: string; blurb: string }[] = [
  {
    id: 'session',
    label: 'sessions & conversations',
    blurb: 'Start, resume, branch, and export conversations — and move them between devices.',
  },
  {
    id: 'context',
    label: 'context & memory',
    blurb: 'Control what the agent sees: working directories, context usage, memory, and project knowledge.',
  },
  {
    id: 'models',
    label: 'openrouter, models & enxame',
    blurb: 'Sign in to OpenRouter, pick a model, watch your balance, and configure the Enxame swarm.',
  },
  {
    id: 'workflow',
    label: 'code review & git',
    blurb: 'Review diffs and pull requests, run security reviews, and connect GitHub or Slack.',
  },
  {
    id: 'tools',
    label: 'tools & integrations',
    blurb: 'MCP servers, language servers, IDEs, web search, plugins, skills, agents, and hooks.',
  },
  {
    id: 'customization',
    label: 'ui & customization',
    blurb: 'Themes, keybindings, vim mode, the status line, and editor ergonomics.',
  },
  {
    id: 'diagnostics',
    label: 'help & diagnostics',
    blurb: 'Check status, diagnose the installation, and inspect session statistics.',
  },
]

export const commands: SlashCommand[] = [
  // ── sessions & conversations ─────────────────────────────────────────
  { name: 'clear', description: 'Clear conversation history and free up context', category: 'session' },
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', category: 'session', args: '<optional custom summarization instructions>' },
  { name: 'resume', description: 'Resume a previous conversation', category: 'session', args: '[conversation id or search term]' },
  { name: 'rename', description: 'Rename the current conversation', category: 'session', args: '[name]' },
  { name: 'branch', description: 'Create a branch of the current conversation at this point', category: 'session', args: '[name]' },
  { name: 'rewind', description: 'Restore the code and/or conversation to a previous point', category: 'session' },
  { name: 'export', description: 'Export the current conversation to a file or clipboard', category: 'session', args: '[filename]' },
  { name: 'copy', description: "Copy the agent's last response to clipboard (or /copy N for the Nth-latest)", category: 'session' },
  { name: 'continue', description: 'Continue the current task', category: 'session', args: '[optional instruction]' },
  { name: 'replay', description: 'Replay a session showing tool execution timeline', category: 'session', args: '[session id or search term]' },
  { name: 'tag', description: 'Toggle a searchable tag on the current session', category: 'session', args: '<tag-name>' },
  { name: 'btw', description: 'Ask a quick side question without interrupting the main conversation', category: 'session', args: '<question>' },
  { name: 'goal', description: 'Set and manage a session completion goal', category: 'session', args: '[condition|status|pause|resume|clear]' },
  { name: 'tasks', description: 'List and manage background tasks', category: 'session' },
  { name: 'session', description: 'Show remote session URL and QR code', category: 'session' },
  { name: 'exit', description: 'Exit the REPL', category: 'session' },

  // ── context & memory ─────────────────────────────────────────────────
  { name: 'context', description: 'Show current context usage', category: 'context' },
  { name: 'ctx', description: 'Show context window usage and token breakdown', category: 'context' },
  { name: 'repomap', description: 'Show or configure the repository structural map (codebase intelligence)', category: 'context' },
  { name: 'files', description: 'List all files currently in context', category: 'context' },
  { name: 'add-dir', description: 'Add a new working directory', category: 'context', args: '<path>' },
  { name: 'init', description: 'Initialize a new project instruction file with codebase documentation', category: 'context' },
  { name: 'memory', description: 'Edit persistent memory files', category: 'context' },
  { name: 'dream', description: 'Run memory consolidation — synthesize recent sessions into durable memories', category: 'context' },
  { name: 'knowledge', description: 'Manage the native Knowledge Graph', category: 'context', args: 'enable <yes|no> | clear | status | list' },
  { name: 'wiki', description: 'Initialize and inspect the HuberClaude project wiki', category: 'context', args: '[init|status|scan|ingest <path>]' },
  { name: 'cost', description: 'Show the total cost and duration of the current session', category: 'context' },
  { name: 'request-size', description: 'Show estimated request context load and top contributors', category: 'context' },
  { name: 'cache-stats', description: 'Show per-turn and session cache hit/miss stats', category: 'context' },

  // ── models & providers ───────────────────────────────────────────────
  { name: 'model', description: 'Pick an OpenRouter model for the session', category: 'models', args: '[model]' },
  { name: 'effort', description: 'Set effort level for model usage', category: 'models', args: '[low|medium|high|xhigh|max|ultracode|auto]' },
  { name: 'set-context-window', description: 'Set a session-scoped context window override for a model', category: 'models', args: '[model] <tokens>' },
  { name: 'clear-context-window', description: 'Clear session-scoped context window overrides', category: 'models', args: '[model]' },
  { name: 'smartroute', description: 'Configure smart auto-routing (experimental): route simple turns to your configured simple model', category: 'models', args: '[on|off|simple <key>|strong <key>]' },
  { name: 'login', description: 'Configure the OpenRouter API key and base URL', category: 'models' },
  { name: 'usage', description: 'Show OpenRouter balance and spend as a fuel gauge scaled to the last recharge', category: 'models' },
  { name: 'enxame', description: 'Register the z.ai account and configure the swarm: on/off, mode (tool/agent/both), and workers (1-10)', category: 'models' },

  // ── code review & git ────────────────────────────────────────────────
  { name: 'diff', description: 'View uncommitted changes and per-turn diffs', category: 'workflow' },
  { name: 'bughunter', description: 'Systematic four-phase bug hunt: map → hunt → skeptic pass → fix proposals', category: 'workflow' },
  { name: 'bughunter-security', description: 'Security-focused bug hunt: exploit-driven, OWASP-aligned, confidence ≥ 8', category: 'workflow' },
  { name: 'bughunter-perf', description: 'Performance-focused bug hunt: hot-path complexity, sync I/O, leaks, N+1 queries', category: 'workflow' },
  { name: 'review', description: 'Review a pull request', category: 'workflow' },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch', category: 'workflow' },
  { name: 'pr-comments', description: 'Get comments from a GitHub pull request', category: 'workflow' },
  { name: 'auto-fix', description: 'Configure auto-fix: run lint/test after AI edits', category: 'workflow' },
  { name: 'plan', description: 'Enable plan mode or view the current session plan', category: 'workflow', args: '[open|<description>]' },
  { name: 'install-github-app', description: 'Set up GitHub Actions integration for a repository', category: 'workflow' },
  { name: 'install-slack-app', description: 'Install the Slack app integration', category: 'workflow' },

  // ── tools & integrations ─────────────────────────────────────────────
  { name: 'mcp', description: 'Manage MCP servers', category: 'tools', args: '[enable|disable [server-name]]' },
  { name: 'lsp', description: 'Inspect and set up Language Server Protocol code intelligence', category: 'tools', args: 'status | recommend [path] | install <plugin-id> | uninstall <plugin-id> | restart' },
  { name: 'ide', description: 'Manage IDE integrations and show status', category: 'tools', args: '[open]' },
  { name: 'search', description: 'Choose the web search backend (Exa by default) and manage its API key', category: 'tools', args: '[status | test | key | remove-key | auto | exa | tavily | brave | …]' },
  { name: 'plugin', description: 'Manage HuberClaude plugins', category: 'tools' },
  { name: 'reload-plugins', description: 'Activate pending plugin changes in the current session', category: 'tools' },
  { name: 'skills', description: 'List available skills', category: 'tools' },
  { name: 'agents', description: 'Manage agent configurations', category: 'tools' },
  { name: 'hooks', description: 'View hook configurations for tool events', category: 'tools' },
  { name: 'permissions', description: 'Manage allow & deny tool permission rules', category: 'tools' },
  { name: 'chrome', description: 'Claude in Chrome (Beta) settings', category: 'tools' },

  // ── ui & customization ───────────────────────────────────────────────
  { name: 'config', description: 'Open the config panel', category: 'customization' },
  { name: 'theme', description: 'Change the theme', category: 'customization' },
  { name: 'logo', description: 'Change the startup logo color scheme', category: 'customization' },
  { name: 'color', description: 'Set the prompt bar color for this session', category: 'customization', args: '<color|default>' },
  { name: 'keybindings', description: 'Open or create your keybindings configuration file', category: 'customization' },
  { name: 'vim', description: 'Toggle between Vim and Normal editing modes', category: 'customization' },
  { name: 'statusline', description: "Set up HuberClaude's status line UI", category: 'customization' },
  { name: 'terminal-setup', description: 'Install the Shift+Enter key binding for newlines', category: 'customization' },
  { name: 'commit-message', description: 'Configure commit attribution text', category: 'customization', args: '[status|off|default|set "text"|co-author <name> <email>]' },
  { name: 'buddy', description: 'Hatch, pet, and manage your HuberClaude companion', category: 'customization', args: '[status|mute|unmute|set <form>|name <name>|help]' },

  // ── help & diagnostics ───────────────────────────────────────────────
  { name: 'help', description: 'Show help and available commands', category: 'diagnostics' },
  { name: 'status', description: 'Show status including version, model, account, API connectivity, and tool statuses', category: 'diagnostics' },
  { name: 'doctor', description: 'Diagnose and verify your HuberClaude installation and settings', category: 'diagnostics' },
  { name: 'diagnostics', description: 'Show available LSP diagnostics already captured for this session', category: 'diagnostics' },
  { name: 'stats', description: 'Show your usage statistics and activity', category: 'diagnostics' },
  { name: 'insights', description: 'Generate a report analyzing your HuberClaude sessions', category: 'diagnostics' },
  { name: 'release-notes', description: 'View release notes', category: 'diagnostics' },
  { name: 'feedback', description: 'Submit feedback about HuberClaude', category: 'diagnostics', args: '[report]' },
  { name: 'cache-probe', description: 'Send identical requests to test prompt caching (results in debug log)', category: 'diagnostics', args: '[model] [--no-key]' },
  { name: 'update', description: 'Update HuberClaude to the latest version', category: 'diagnostics', args: '[latest|stable|<version>] [--force]' },
  { name: 'privacy-settings', description: 'View and update your privacy settings', category: 'diagnostics' },
]

export function commandsByCategory(category: CommandCategory): SlashCommand[] {
  return commands.filter(c => c.category === category)
}
