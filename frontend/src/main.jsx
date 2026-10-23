import { authReady } from './services/supabaseAuth.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { installTelemetry } from './services/telemetry.js';
import App from './App.jsx';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import './styles/site.css';
/* styles/admin.css is loaded by the staff pages themselves (pages/Portal/Portal.jsx): it is a
   third of the stylesheet and nothing a customer sees uses it, and the browser cannot draw
   anything until the stylesheet it is given has arrived. */
/* account security and My Account (kept beside the numbered styles; site.css may @import it after 33-vocab.css instead) */
import './styles/34-account-security.css';
/* account types and prints, the cart, the shop's search (Oct 15) */
import './styles/35-cart-prints.css';
import './styles/36-readable-auth.css';
/* the brighter magical forest look (Oct 16): loaded last */
import './styles/37-magic-forest.css';
import './styles/38-countdown.css';

installTelemetry();

authReady.then(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
));
