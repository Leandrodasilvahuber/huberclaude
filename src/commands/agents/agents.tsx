import * as React from 'react';
import { AgentsDiagram } from '../../components/agents/AgentsDiagram.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <AgentsDiagram onSetActiveAgent={context.setActiveSessionAgent} onExit={message => onDone(message, {
    display: 'system'
  })} />;
}
