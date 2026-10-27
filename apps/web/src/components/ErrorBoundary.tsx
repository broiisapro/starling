import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** Human name for the region, used in the log line and the default fallback. */
  name: string;
  children: ReactNode;
  /** Custom fallback. Receives the error so a panel can show its message. */
  fallback?: (error: Error) => ReactNode;
  /** Changing this clears a caught error (e.g. switching run or view). */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error?: Error;
}

/**
 * Region-level error boundary. On stage one crashing panel must never blank the dashboard: the
 * other five keep flying and the broken region shows the `RegionPlaceholder` fallback.
 *
 * A class component because React 19 still has no hook for `getDerivedStateFromError`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Deliberately one line and no stack dump: the point is that the rest of the dashboard survives.
    console.error(`[starling] the ${this.props.name} region crashed:`, error.message, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error !== undefined && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback(error);
    return (
      <p role="alert" className="p-3 text-caption text-ink-3">
        The {this.props.name} panel hit turbulence: {error.message}
      </p>
    );
  }
}
