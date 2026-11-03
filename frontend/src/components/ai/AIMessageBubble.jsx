import { m } from 'framer-motion';
import { SNAPPY } from '../motion/presets.js';
import AIMark from './AIMark.jsx';

/* the robot in a small dark circle, beside every answer and in the header */
export function AIAvatar({ size }) {
  return <span className={'ai-avatar' + (size ? ' ' + size : '')} aria-hidden="true"><AIMark /></span>;
}

/* one message: answers on the left with the robot, the visitor's on the right */
export default function AIMessageBubble({ from, text, file, typing }) {
  const ai = from === 'ai';
  return (
    /* each message springs up from its own side, like a speech bubble popping out */
    <m.div className={'ai-msg ' + (ai ? 'from-ai' : 'from-user')} style={{ originX: ai ? 0 : 1, originY: 1 }}
      initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SNAPPY}>
      {ai && <AIAvatar />}
      <div className="ai-bubble">
        {typing ? <span className="ai-typing" role="status" aria-label="Typing"><i /><i /><i /></span> : (
          <>
            {file && <span className="ai-file">📎 {file.name}</span>}
            {text}
          </>
        )}
      </div>
    </m.div>
  );
}
