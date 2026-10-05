import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSite } from '../../context/SiteContext.jsx';
import { sendChatMessage } from '../../services/aiChat.js';
import { AI_WELCOME, AI_ERROR } from '../../data/aiAssistant.js';
import AIChatButton from './AIChatButton.jsx';
import AIChatPanel from './AIChatPanel.jsx';

let lastId = 0;
const note = (from, text, file) => ({ id: ++lastId, from, text, file });
const fresh = () => [note('ai', AI_WELCOME)];

/* The "Ask AI" helper: a round logo button at the bottom right that opens a chat
   panel over the landing page (no new address; the page stays behind it).
   It shows on the landing page only, once the opening veil has lifted.
   Minimize keeps the conversation; Close ends it and starts fresh next time. */
export default function AIAssistant() {
  const { pathname } = useLocation();
  const { siteStage } = useSite();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(fresh);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(false);
  const pending = useRef(null), openRef = useRef(false), buttonRef = useRef(null), clearTimer = useRef(0);
  openRef.current = open;

  /* back to the round button, so the keyboard does not lose its place */
  const focusButton = () => requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  const show = useCallback(() => { clearTimeout(clearTimer.current); setOpen(true); setUnread(false); }, []);
  const minimize = useCallback(() => { setOpen(false); focusButton(); }, []);
  const close = useCallback(() => {
    pending.current?.abort(); pending.current = null;
    setOpen(false); setTyping(false); setUnread(false); focusButton();
    clearTimer.current = setTimeout(() => setMessages(fresh()), 450);   /* after the panel has slid away */
  }, []);

  const send = useCallback(async (text, file) => {
    setMessages(m => [...m, note('user', text, file && { name: file.name })]);
    setTyping(true);
    const ctrl = new AbortController(); pending.current = ctrl;
    let reply;
    try { reply = await sendChatMessage(text, { file, signal: ctrl.signal }); } catch (_) { reply = ''; }
    if (pending.current !== ctrl) return;   /* closed while the answer was on its way */
    pending.current = null;
    setTyping(false);
    setMessages(m => [...m, note('ai', reply || AI_ERROR)]);
    if (!openRef.current) setUnread(true);
  }, []);

  useEffect(() => () => { pending.current?.abort(); clearTimeout(clearTimer.current); }, []);

  if (pathname !== '/' || siteStage !== 'site') return null;
  return (
    <div className="ai-assistant">
      <AIChatButton ref={buttonRef} open={open} unread={unread} onClick={show} />
      <AIChatPanel open={open} messages={messages} typing={typing} onSend={send} onMinimize={minimize} onClose={close} />
    </div>
  );
}
