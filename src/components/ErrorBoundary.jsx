import { Component } from 'react';

/**
 * Catches unhandled render errors anywhere in the subtree and shows a
 * readable message instead of a blank page.
 * Wrap any high-risk route or the whole app in this component.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Log to console so it also shows up in DevTools
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #fef9ef 0%, #f5e6c8 50%, #ede0c8 100%)',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 560, width: '100%',
          background: '#fff', borderRadius: 14,
          border: '1px solid #e8d5b7',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          padding: 32,
          fontFamily: "'Georgia', serif",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ color: '#c0392b', marginBottom: 8, fontSize: 20 }}>
            Something went wrong
          </h2>
          <p style={{ color: '#8a7a6a', marginBottom: 16, lineHeight: 1.6 }}>
            The app ran into an error. The message below will help diagnose the issue:
          </p>
          <pre style={{
            background: '#fdf6ec', border: '1px solid #e8d5b7',
            borderRadius: 8, padding: '12px 16px',
            fontSize: 12, color: '#c0392b',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            marginBottom: 20, lineHeight: 1.6,
            maxHeight: 200, overflowY: 'auto',
          }}>
            {this.state.error?.toString()}
            {this.state.info?.componentStack && (
              '\n\n' + this.state.info.componentStack.slice(0, 600)
            )}
          </pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '10px 20px', borderRadius: 8,
                background: '#c9a96e', color: '#fff',
                border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 14,
              }}
            >
              ↩ Go to Home
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px', borderRadius: 8,
                background: 'transparent', color: '#8a7a6a',
                border: '1px solid #d4c5a9', cursor: 'pointer',
                fontWeight: 600, fontSize: 14,
              }}
            >
              ↺ Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
