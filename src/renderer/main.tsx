import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useAppStore } from './state/appStore';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/app.css';
import './styles/effects.css';

// Hydrate persisted theme + app info before first paint settles.
void useAppStore.getState().hydrate();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
