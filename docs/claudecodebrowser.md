# ClaudeCodeBrowser (Firefox)

Se o ClaudeCodeBrowser estiver instalado em `~/.claudecodebrowser`
(arquivo `mcp-server/stdio_wrapper.py`), o OpenClaude registra automaticamente
o servidor MCP `claudecodebrowser` na inicialização, expondo as ferramentas
`mcp__claudecodebrowser__*` para controlar o Firefox.

Requisitos:

- `python3` no PATH.
- Extensão Firefox do ClaudeCodeBrowser instalada e ativa.

Comportamento:

- Se você já configurou um servidor com o nome `claudecodebrowser` (escopos
  user, local, project ou `--mcp-config`), a sua configuração é mantida.
- As ferramentas seguem o fluxo normal de permissão MCP.
- Para desativar: `OPENCLAUDE_DISABLE_CLAUDECODEBROWSER=1`.
