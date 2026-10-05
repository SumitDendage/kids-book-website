import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Viewer from './pages/Viewer/Viewer.jsx';
import './styles/viewer.css';

/* viewer.html — the protected full-screen sheet viewer (its own page, so old viewer.html#t=… links keep working) */
createRoot(document.getElementById('viewer-root')).render(<StrictMode><Viewer /></StrictMode>);
