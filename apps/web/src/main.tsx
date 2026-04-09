import React, { Component } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthProvider.js';
import { AppRouter } from './app/Router.js';
import './index.css';

interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error: Error | null }

class RootErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '800px', margin: '0 auto' }}>
          <h1 style={{ color: '#dc2626', fontSize: '1.25rem', marginBottom: '1rem' }}>Application Error</h1>
          <pre style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.875rem', color: '#991b1b' }}>
            {error?.message}
          </pre>
          <details style={{ marginTop: '1rem' }}>
            <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '0.875rem' }}>Stack trace</summary>
            <pre style={{ marginTop: '0.5rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.75rem', color: '#374151' }}>
              {error?.stack}
            </pre>
          </details>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
