import * as React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { OpenRouterUsageDialog } from './OpenRouterUsageDialog.js';
export const call: LocalJSXCommandCall = async onDone => {
  return <OpenRouterUsageDialog onClose={() => onDone(undefined, { display: 'skip' })} />;
};
