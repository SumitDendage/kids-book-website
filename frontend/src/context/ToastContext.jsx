import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { SNAPPY } from '../components/motion/presets.js';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

/* the little white pill at the bottom of the screen (2.2 s) */
export function ToastProvider({ children }) {
  const [state, setState] = useState({ msg: '', show: false });
  const timer = useRef(0);
  const toast = useCallback(msg => { setState({ msg, show: true }); clearTimeout(timer.current); timer.current = setTimeout(() => setState(s => ({ ...s, show: false })), 2200); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* it pops up with a little bounce and sinks away again */}
      <m.div className={'toast' + (state.show ? ' show' : '')} id="toast" role="status" aria-live="polite"
        initial={false} animate={state.show ? { x: '-50%', y: 0, scale: 1 } : { x: '-50%', y: 14, scale: 0.9 }} transition={SNAPPY}>{state.msg}</m.div>
    </ToastContext.Provider>
  );
}
