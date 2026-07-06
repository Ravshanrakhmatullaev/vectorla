import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback: ReactNode
}

interface State {
  hasError: boolean
}

/** Generic error boundary — React requires this to be a class component. Pass an on-brand `fallback` node from the caller (see ErrorFallback). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: unknown) {
    console.error('Uncaught render error:', error, info)
  }

  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
