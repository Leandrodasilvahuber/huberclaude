import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getLizardRows, getStarRows, type LizardCell } from './lizardSprite.js';

const LIZARD_ROWS = getLizardRows();
const STAR_ROWS = getStarRows();

function Sprite({ rows }: { rows: LizardCell[][] }) {
  return <Box flexDirection="column" flexShrink={0}>
      {rows.map((row, y) => <Text key={y}>
          {row.map((cell, x) => cell.fg || cell.bg ? <Text key={x} color={cell.fg} backgroundColor={cell.bg}>{cell.char}</Text> : cell.char)}
        </Text>)}
    </Box>;
}

/** HuberClaude mascot: the lagartixa, drawn with half-block pixels. */
export function Clawd() {
  return <Sprite rows={LIZARD_ROWS} />;
}

/** Green pixel-art star shown in the fixed header; `color` tints it (e.g. /color). */
export function GreenStar({ color }: { color?: string } = {}) {
  const rows = React.useMemo(() => color ? getStarRows(color) : STAR_ROWS, [color]);
  return <Sprite rows={rows} />;
}
