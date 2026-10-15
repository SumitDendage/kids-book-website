import { useEffect, useRef } from 'react';
import AIChatHeader from './AIChatHeader.jsx';
import AIChatMessages from './AIChatMessages.jsx';
import AIChatInput from './AIChatInput.jsx';

/* the chat window: slides in from the right over the page, which stays where it is */
export default function AIChatPanel({ open, messages, typing, onSend, onMinimize, onClose }) {
  const ref = useRef(null), inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
    /* phones: keep the panel inside the part of the screen the keyboard leaves free */
    const vv = window.visualViewport, el = ref.current;
    const fit = () => { el.style.setProperty('--ai-vv-h', vv.height + 'px'); el.style.setProperty('--ai-vv-top', vv.offsetTop + 'px'); };
    if (vv && el) { fit(); vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    return () => { clearTimeout(t); if (vv && el) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } };
  }, [open]);

  /* the page turns chapters on wheel, swipe and arrow keys; inside the chat they belong to the chat */
  const keep = e => e.stopPropagation();
  const onKeyDown = e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onMinimize(); } };

  return (
    <section
      id="ai-chat" ref={ref} className={'ai-panel' + (open ? ' open' : '')}
      role="dialog" aria-labelledby="ai-chat-title" inert={!open}
      onKeyDown={onKeyDown} onWheel={keep} onTouchStart={keep} onTouchMove={keep}
    >
      <AIChatHeader onMinimize={onMinimize} onClose={onClose} />
      <AIChatMessages messages={messages} typing={typing} />
      <AIChatInput ref={inputRef} busy={typing} onSend={onSend} />
    </section>
  );
}
