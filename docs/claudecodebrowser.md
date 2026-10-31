# ClaudeCodeBrowser (Firefox)

Se o ClaudeCodeBrowser estiver instalado em `~/.claudecodebrowser`
(arquivo `mcp-server/stdio_wrapper.py`), o HuberClaude registra automaticamente
o servidor MCP `claudecodebrowser` na inicialização, expondo as ferramentas
`mcp__claudecodebrowser__*` para controlar o Firefox.

Requisitos:

- `python3` no PATH.
- Extensão Firefox do ClaudeCodeBrowser instalada e ativa.

Comportamento:

- Se você já configurou um servidor com o nome `claudecodebrowser` (escopos
  user, local, project ou `--mcp-config`), a sua configuração é mantida.
- Se você rejeitou um servidor `claudecodebrowser` vindo do `.mcp.json` de um
  projeto, o registro automático volta a valer.
- Não é registrado com `--strict-mcp-config`, `--bare`, sem `python3` no PATH
  nem quando existe um `managed-mcp.json` (configuração corporativa).
- Respeita `allowedMcpServers` / `deniedMcpServers` da política.
- As ferramentas seguem o fluxo normal de permissão MCP.
- Para desativar: `OPENCLAUDE_DISABLE_CLAUDECODEBROWSER=1`.
