export const ENXAME_TOOL_NAME = 'Enxame'

export function getDescription(workers: number): string {
  return `Fan out small, independent sub-tasks to a swarm of fast, cheap z.ai workers (GLM flash models), up to ${workers} running in parallel. Each worker is stateless: it sees ONLY the prompt (and optional system) you give it — no conversation history, no files, no tools.

## When to use
- Several independent text jobs that can run at the same time: summarize N files/snippets, extract fields, classify items, translate, draft boilerplate or tests from code you paste in, compare alternatives.
- Mechanical work where a smaller model is enough, to save your own tokens.

## When NOT to use
- Work that needs to read files, run commands or follow up — do that yourself or use a subagent.
- Hard reasoning or decisions: you stay the planner; workers only execute.
- A single tiny task you could answer directly.

## How to write tasks
- Put ALL the data a worker needs inside its prompt (paste the snippet/text). It cannot see anything else.
- Ask for a short, structured answer (e.g. "Reply only with JSON {\\"name\\":..., \\"risk\\":...}"). No explanations.
- Give each task a short unique id so you can match results.
- Never include secrets, API keys or credentials.
- Workers are weaker models: check their output before relying on it.

Returns a JSON array of {id, ok, text} or {id, ok:false, error}, in input order.`
}
