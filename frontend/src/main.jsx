import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { installTelemetry } from './services/telemetry.js';
import App from './App.jsx';
import './styles/site.css';
import './styles/admin.css';

installTelemetry();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
