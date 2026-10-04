import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './lib/i18n';
// Fonts are served from this app's own origin (bundled by Vite from the
// Fontsource packages), never from a third-party CDN - see
// public/fonts-LICENSE.txt for their licence. Weights match what the UI uses:
// Manrope 400-800 and JetBrains Mono 300-700 come from the variable files,
// Rajdhani (static only) 500/600/700.
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
