import { Component, type ReactNode } from 'react'
import { readable } from '@sisyphus/sdk'

/** A failed contribution must not make the rest of Settings inaccessible. */
export class SectionBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: unknown) {
    return { error: readable(error) }
  }
  render() {
    if (this.state.error)
      return (
        <div>
          <p role="alert">This settings section could not be displayed. {this.state.error}</p>
          <button onClick={() => this.setState({ error: '' })}>Retry</button>
        </div>
      )
    return this.props.children
  }
}
