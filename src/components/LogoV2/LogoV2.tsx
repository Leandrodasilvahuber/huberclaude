import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { feature } from 'bun:bundle';
import { isDebugMode, isDebugToStdErr, getDebugLogPath } from 'src/utils/debug.js';
import { CondensedLogo } from './CondensedLogo.js';
import { EmergencyTip } from './EmergencyTip.js';
import { VoiceModeNotice } from './VoiceModeNotice.js';
import { Opus1mMergeNotice } from './Opus1mMergeNotice.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const ChannelsNoticeModule = feature('KAIROS') || feature('KAIROS_CHANNELS') ? require('./ChannelsNotice.js') as typeof import('./ChannelsNotice.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

/** Session header shown at the top of the transcript. */
export function LogoV2() {
  return <>
      <CondensedLogo />
      <VoiceModeNotice />
      <Opus1mMergeNotice />
      {ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />}
      {isDebugMode() && <Box paddingLeft={2} flexDirection="column"><Text color="warning">Debug mode enabled</Text><Text dimColor={true}>Logging to: {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}</Text></Box>}
      <EmergencyTip />
    </>;
}
