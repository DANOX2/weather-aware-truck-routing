import { createTheme } from '@mui/material/styles'

// Palette sampled from spotter.ai (Lens / TMS / Sentinel) so the app feels native to the team.
export const tokens = {
  navy: '#061830',
  navyDeep: '#040F1F',
  surface: '#0D1E2D',
  surfaceRaised: '#0A1F36',
  panel: '#04283C',
  turquoise: '#40E0D0',
  teal: '#008080',
  mint: '#14D29B',
  coral: '#F84960',
  amber: '#FFA600',
  textMuted: '#C4D0D6',
  border: 'rgba(255, 255, 255, 0.08)',
  borderAccent: 'rgba(64, 224, 208, 0.2)',
} as const

// Ordered Low → No Travel; mirrors the backend RiskLevel enum.
export const riskColors = {
  LOW: '#14D29B',
  MODERATE: '#FFC107',
  HIGH: '#FF8A3D',
  SEVERE: '#F84960',
  NO_TRAVEL: '#AF270D',
} as const

// Route identity colours: distinct from every risk colour and from each other on the dark map.
export const routeColors = ['#40E0D0', '#7AA2FF', '#D59BFF', '#F5F5F5', '#FFD3A8'] as const

export const monoFont = '"DM Mono", ui-monospace, monospace'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: tokens.turquoise, contrastText: tokens.navy },
    secondary: { main: tokens.coral },
    success: { main: tokens.mint },
    warning: { main: tokens.amber },
    error: { main: tokens.coral },
    background: { default: tokens.navy, paper: tokens.surface },
    text: { primary: '#FFFFFF', secondary: tokens.textMuted },
    divider: tokens.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${tokens.border}` } },
    },
  },
})
