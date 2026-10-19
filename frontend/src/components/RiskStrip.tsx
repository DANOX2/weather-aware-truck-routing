import { Box, Tooltip } from '@mui/material'

import type { Checkpoint, RiskLevel } from '../api/types.ts'
import { RISK_LABEL, formatTime } from '../lib/format.ts'
import { riskColors, tokens } from '../theme.ts'

interface Run {
  level: RiskLevel | null
  miles: number
  fromMile: number
  toMile: number
  fromEta: string
  toEta: string
}

/** Consecutive checkpoints with the same level become one stretch. */
function toRuns(checkpoints: Checkpoint[]): Run[] {
  const runs: Run[] = []
  for (const cp of checkpoints) {
    const last = runs.at(-1)
    if (last && last.level === cp.level) {
      last.miles += cp.represents_mi
      last.toMile = cp.mile
      last.toEta = cp.eta
    } else {
      runs.push({
        level: cp.level,
        miles: cp.represents_mi,
        fromMile: cp.mile,
        toMile: cp.mile,
        fromEta: cp.eta,
        toEta: cp.eta,
      })
    }
  }
  return runs
}

/** The route as one bar from origin to destination, each stretch in its risk colour. */
export function RiskStrip({ checkpoints, height = 8 }: { checkpoints: Checkpoint[]; height?: number }) {
  const runs = toRuns(checkpoints)
  const total = runs.reduce((sum, r) => sum + r.miles, 0) || 1
  return (
    <Box
      role="img"
      aria-label={`Risk along the route: ${runs
        .map((r) => `${r.level ? RISK_LABEL[r.level] : 'no forecast'} for ${Math.round(r.miles)} miles`)
        .join(', then ')}`}
      sx={{ display: 'flex', height, borderRadius: height, overflow: 'hidden' }}
    >
      {runs.map((run) => (
        <Tooltip
          key={run.fromMile}
          title={`${run.level ? RISK_LABEL[run.level] : 'No forecast yet'} · mile ${Math.round(
            run.fromMile,
          )}–${Math.round(run.toMile)} · ${formatTime(run.fromEta)}–${formatTime(run.toEta)}`}
          disableInteractive
        >
          <Box
            sx={{
              flexGrow: run.miles / total,
              flexBasis: 0,
              bgcolor: run.level ? riskColors[run.level] : tokens.border,
              opacity: run.level === 'LOW' ? 0.55 : 1,
            }}
          />
        </Tooltip>
      ))}
    </Box>
  )
}
