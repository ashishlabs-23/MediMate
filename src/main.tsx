import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          role="main"
          className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="max-w-md w-full bg-surface border border-slate-200 rounded-card p-8 shadow-sm">
            <span className="text-4xl mb-4 block">💊</span>
            <h1 className="text-2xl font-bold text-ink-primary mb-2">MediMate</h1>
            <p className="text-sm text-ink-secondary mb-4">
              An unexpected issue occurred while starting the application.
            </p>
            {this.state.error?.message && (
              <pre className="text-xs bg-slate-100 text-alert p-3 rounded-btn text-left overflow-auto mb-4 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark transition-colors"
            >
              Reload Application
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/firebase-messaging-sw.js')
      .catch((err: unknown) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
