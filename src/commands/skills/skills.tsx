import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { SkillsDiagram } from '../../components/skills/SkillsDiagram.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <SkillsDiagram commands={context.options.commands} onExit={message => onDone(message, {
    display: 'system'
  })} />;
}
