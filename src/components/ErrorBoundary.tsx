import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error) {
    console.error('Application ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      let parsedMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          parsedMsg = `${parsed.error}${parsed.path ? ` (${parsed.operationType} on ${parsed.path})` : ''}`;
        }
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Application Error</h2>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-300 break-words leading-relaxed">
              {parsedMsg}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Shawarma Cafe POS
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
