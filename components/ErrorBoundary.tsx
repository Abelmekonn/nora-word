import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary Component
 *
 * Catches unhandled React errors and displays a fallback UI instead of crashing the entire app.
 *
 * Usage:
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to error reporting service (e.g., Sentry, LogRocket)
    console.error('Error caught by ErrorBoundary:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // TODO: Send to error tracking service
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8 border border-slate-200">
            {/* Error Icon */}
            <div className="flex items-center justify-center mb-6">
              <div className="bg-red-100 rounded-full p-4">
                <svg
                  className="w-12 h-12 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* Error Message */}
            <h2 className="text-2xl font-bold text-slate-900 text-center mb-4">
              Something went wrong
            </h2>
            <p className="text-slate-600 text-center mb-6">
              We're sorry for the inconvenience. The application encountered an unexpected error and needs to reload.
            </p>

            {/* Error Details (Development Only) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6 bg-slate-50 rounded-lg p-4 border border-slate-200">
                <summary className="cursor-pointer font-semibold text-slate-700 mb-2">
                  Technical Details (Development Mode)
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm text-slate-700 mb-1">Error:</h4>
                    <pre className="text-xs text-red-600 bg-white p-3 rounded border border-red-200 overflow-x-auto">
                      {this.state.error.toString()}
                    </pre>
                  </div>
                  {this.state.errorInfo && (
                    <div>
                      <h4 className="font-semibold text-sm text-slate-700 mb-1">Component Stack:</h4>
                      <pre className="text-xs text-slate-600 bg-white p-3 rounded border border-slate-200 overflow-x-auto">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition-colors duration-200"
              >
                Reload Application
              </button>
            </div>

            {/* Help Text */}
            <p className="text-center text-sm text-slate-500 mt-6">
              If the problem persists, please{' '}
              <a
                href="mailto:support@noralegal.com"
                className="text-indigo-600 hover:text-indigo-700 underline"
              >
                contact support
              </a>
              .
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;