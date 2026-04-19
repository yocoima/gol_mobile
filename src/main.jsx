import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Root render error', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: 'linear-gradient(180deg, #091a2f, #06111f)',
          color: '#fff'
        }}>
          <div style={{
            maxWidth: '720px',
            width: '100%',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '24px',
            background: 'rgba(7, 14, 27, 0.88)',
            padding: '24px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.35)'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#fca5a5' }}>
              Error de interfaz
            </div>
            <h1 style={{ margin: '12px 0', fontSize: '28px' }}>La app fallo al renderizar</h1>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'rgba(255,255,255,0.82)', margin: 0 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
