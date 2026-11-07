import { Component, type ErrorInfo, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Never log titles, source paths or report data. */
  }
  render() {
    if (this.state.failed)
      return (
        <div className="empty-feature">
          <h2>The workspace couldn’t be displayed.</h2>
          <p>
            Your local data has been kept. Reload the workspace to try again.
          </p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
