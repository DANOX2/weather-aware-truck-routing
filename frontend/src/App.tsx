import { Box, Typography } from '@mui/material'

import { tokens } from './theme.ts'

// Shell only: trip form + route list (left) and map (right) land in Phase 3.
export default function App() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { md: '400px 1fr' }, height: '100vh' }}>
      <Box component="aside" sx={{ p: 3, borderRight: `1px solid ${tokens.border}` }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Weather-Aware <Box component="span" sx={{ color: 'primary.main' }}>Truck Routing</Box>
        </Typography>
      </Box>
      <Box component="main" sx={{ bgcolor: tokens.navyDeep }} />
    </Box>
  )
}
