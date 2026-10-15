import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React from 'react'
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Text } from '../../ink.js'
import type { ToolProgressData } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import type { Output } from './EnxameTool.js'

type PartialInput = Partial<{ tasks?: { id?: string }[] }>

export function getToolUseSummary(input: PartialInput | undefined): string | null {
  const count = input?.tasks?.length ?? 0
  return `Enxame (${count} ${count === 1 ? 'task' : 'tasks'})`
}

export function renderToolUseMessage(input: PartialInput): React.ReactNode {
  const count = input.tasks?.length ?? 0
  return `${count} ${count === 1 ? 'task' : 'tasks'}`
}

export function renderToolResultMessage(
  output: Output,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const failed = output.results.filter(r => !r.ok)
  const summary = `${output.results.length - failed.length}/${output.results.length} workers ok`
  return (
    <MessageResponse height={verbose ? undefined : 1}>
      <Text>
        {summary}
        {verbose && failed.length > 0
          ? failed.map(r => `\n✗ ${r.id}: ${r.ok ? '' : r.error}`).join('')
          : ''}
      </Text>
    </MessageResponse>
  )
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}
