import { Box, Stack, Typography } from '@mui/material'

import { RISK_LEVELS } from '../api/types.ts'
import { RISK_LABEL } from '../lib/format.ts'
import { riskColors } from '../theme.ts'

export function RiskLegend({ dense = false }: { dense?: boolean }) {
  return (
    <Stack direction="row" spacing={dense ? 1.25 : 2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {RISK_LEVELS.map((level) => (
        <Stack key={level} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box
            sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: riskColors[level] }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {RISK_LABEL[level]}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}
