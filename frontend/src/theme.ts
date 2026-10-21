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

// One duration scale and one easing, so panels, cards and the map controls all settle the same
// way instead of each picking its own timing. Decoration only: the reduced-motion rule in
// MuiCssBaseline switches it all off, so no component has to remember to check.
export const motion = {
  fast: '140ms',
  base: '220ms',
  slow: '360ms',
  ease: 'cubic-bezier(0.22, 0.61, 0.36, 1)', // decelerating, so things land rather than stop
} as const

/** Fade-and-rise entrance. `delay` staggers a list without a keyframe set per item. */
export const rise = (delay = 0) => ({
  animation: `rise ${motion.slow} ${motion.ease} both`,
  animationDelay: `${delay}ms`,
  '@keyframes rise': {
    from: { opacity: 0, transform: 'translateY(8px)' },
    to: { opacity: 1, transform: 'none' },
  },
})

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
    MuiCssBaseline: {
      styleOverrides: {
        // Honour the OS setting in one place. Near-zero rather than `none` so animations still
        // fire their end events and anything waiting on them isn't left hanging.
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '1ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '1ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
  },
})
