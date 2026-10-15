import * as React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { EnxameDialog } from './EnxameDialog.js';
export const call: LocalJSXCommandCall = async onDone => {
  return <EnxameDialog onClose={() => onDone(undefined, { display: 'skip' })} />;
};
