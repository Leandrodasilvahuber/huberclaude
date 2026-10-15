import * as React from 'react';
import { BRAND_NAME } from '../../constants/brand.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { truncate } from '../../utils/format.js';
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { GreenStar } from './Clawd.js';

const SPRITE_WIDTH = 13;

/** Fixed header: lagartixa mascot on the left, name/model/path on the right. */
export function CondensedLogo() {
  const { columns } = useTerminalSize();
  const agent = useAppState(s => s.agent);
  const effortValue = useAppState(s => s.effortValue);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const { version, cwd, billingType, agentName: agentNameFromSettings } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const textWidth = Math.max(columns - SPRITE_WIDTH - 4, 20);
  const truncatedVersion = truncate(version.replace(/^HuberClaude\s*/, ''), Math.max(textWidth - BRAND_NAME.length - 2, 6));
  const { shouldSplit, truncatedModel, truncatedBilling } = formatModelAndBilling(modelDisplayName + getEffortSuffix(model, effortValue), billingType, textWidth);
  const path = truncatePath(cwd, Math.max(textWidth - (agentName ? agentName.length + 4 : 0), 10));
  return <OffscreenFreeze>
      <Box flexDirection="row" gap={2} alignItems="center" paddingX={1}>
        <GreenStar />
        <Box flexDirection="column">
          <Text><Text bold={true} color="brand">{BRAND_NAME}</Text> <Text dimColor={true}>{truncatedVersion}</Text></Text>
          {shouldSplit ? <>
              <Text dimColor={true}>{truncatedModel}</Text>
              <Text dimColor={true}>{truncatedBilling}</Text>
            </> : <Text dimColor={true}>{truncatedModel} · {truncatedBilling}</Text>}
          <Text dimColor={true}>{agentName ? `@${agentName} · ${path}` : path}</Text>
        </Box>
      </Box>
    </OffscreenFreeze>;
}
