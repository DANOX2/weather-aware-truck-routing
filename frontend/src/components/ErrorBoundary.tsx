import RefreshIcon from '@mui/icons-material/Refresh'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What broke, for the message: "the map", "the page". */
  label: string
  /** Reset instead of reloading, when the rest of the page is still usable. */
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * Without one of these a single throw unmounts the whole tree and leaves a blank page, with the
 * reason only in the console. A browser can drop a WebGL context whenever it is under pressure —
 * the map holds two — and nothing in MapLibre or deck.gl turns that into a React-shaped error.
 * Catch it, say so, and keep the rest of the app on screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Left in production on purpose: this is the only record of what went wrong.
    console.error(`[${this.props.label}] crashed`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const reset = this.props.onReset
    return (
      <Alert
        severity="error"
        action={
          <Button
            color="inherit"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => (reset ? (this.setState({ error: null }), reset()) : location.reload())}
          >
            {reset ? 'Reload ' + this.props.label : 'Reload'}
          </Button>
        }
        sx={{ m: 2 }}
      >
        <Stack spacing={0.5}>
          <Typography variant="body2">Something went wrong with {this.props.label}.</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {error.message || String(error)}
          </Typography>
        </Stack>
      </Alert>
    )
  }
}
