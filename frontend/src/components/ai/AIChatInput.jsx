import { useEffect, useRef, useState } from 'react';
import { AI_PLACEHOLDER } from '../../data/aiAssistant.js';

/* speaking a question works where the browser can turn speech into text (Chrome, Edge, Safari) */
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

/* the box at the bottom: attach, speak, type; Enter sends, Shift+Enter starts a new line */
export default function AIChatInput({ ref, busy, onSend }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [listening, setListening] = useState(false);
  const boxRef = useRef(null), fileRef = useRef(null), recRef = useRef(null);
  const setBox = el => { boxRef.current = el; if (ref) ref.current = el; };

  /* the box grows with the text, up to about five lines */
  useEffect(() => { const el = boxRef.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 132) + 'px'; }, [text]);
  useEffect(() => () => recRef.current?.abort(), []);

  const dropFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = ''; };
  const canSend = !busy && !!(text.trim() || file);
  const submit = e => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(text.trim(), file);
    setText(''); dropFile(); recRef.current?.stop();
    boxRef.current?.focus({ preventScroll: true });
  };
  const onKeyDown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };

  const toggleMic = () => {
    if (recRef.current) { recRef.current.stop(); return; }
    const rec = new Speech();
    rec.lang = 'en-IN'; rec.interimResults = false;
    rec.onresult = ev => { const said = Array.from(ev.results).map(r => r[0].transcript).join(' ').trim(); if (said) setText(t => (t ? t + ' ' : '') + said); };
    rec.onend = () => { recRef.current = null; setListening(false); };
    recRef.current = rec; setListening(true);
    try { rec.start(); } catch (_) { recRef.current = null; setListening(false); }
  };

  return (
    <form className="ai-input" onSubmit={submit}>
      {file && (
        <div className="ai-attached">
          <span>📎 {file.name}</span>
          <button type="button" aria-label="Remove the file" onClick={dropFile}>✕</button>
        </div>
      )}
      <div className="ai-input-row">
        <input ref={fileRef} type="file" accept="image/*,.pdf" hidden onChange={e => setFile(e.target.files[0] || null)} />
        <button type="button" className="ai-tool" aria-label="Attach a file" title="Attach a file" onClick={() => fileRef.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
        </button>
        {Speech && (
          <button type="button" className={'ai-tool' + (listening ? ' on' : '')} aria-label={listening ? 'Stop listening' : 'Speak your question'} aria-pressed={listening} title={listening ? 'Stop listening' : 'Speak'} onClick={toggleMic}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
          </button>
        )}
        <textarea ref={setBox} rows={1} value={text} maxLength={1000} placeholder={AI_PLACEHOLDER} aria-label="Your message" onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} />
        <button type="submit" className="ai-send" aria-label="Send" title="Send" disabled={!canSend}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" /></svg>
        </button>
      </div>
    </form>
  );
}
