import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { installTelemetry } from './services/telemetry.js';
import App from './App.jsx';
import './styles/site.css';
import './styles/admin.css';
/* account security and My Account (kept beside the numbered styles; site.css may @import it after 33-vocab.css instead) */
import './styles/34-account-security.css';

installTelemetry();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
