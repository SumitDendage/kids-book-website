import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import '@fontsource-variable/nunito/wght.css';
import './styles/fonts.css';
import './styles/index.css';

/* reducedMotion="user": every Motion transform animation is skipped (opacity
   still fades) when the OS asks for reduced motion. CSS does the same via
   the media query in index.css. */
createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
