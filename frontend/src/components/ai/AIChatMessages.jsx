import { useEffect, useRef } from 'react';
import AIMessageBubble from './AIMessageBubble.jsx';

/* the conversation; it scrolls on its own and follows the newest message */
export default function AIChatMessages({ messages, typing }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' });
  }, [messages, typing]);
  return (
    <div className="ai-messages" ref={ref} role="log" aria-live="polite" aria-label="Conversation">
      {messages.map(m => <AIMessageBubble key={m.id} from={m.from} text={m.text} file={m.file} />)}
      {typing && <AIMessageBubble from="ai" typing />}
    </div>
  );
}
