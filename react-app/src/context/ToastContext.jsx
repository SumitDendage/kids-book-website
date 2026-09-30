import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

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
      <div className={'toast' + (state.show ? ' show' : '')} id="toast" role="status" aria-live="polite">{state.msg}</div>
    </ToastContext.Provider>
  );
}
