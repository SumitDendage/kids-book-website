import AIMark from './AIMark.jsx';

/* the robot in a small dark circle, beside every answer and in the header */
export function AIAvatar({ size }) {
  return <span className={'ai-avatar' + (size ? ' ' + size : '')} aria-hidden="true"><AIMark /></span>;
}

/* one message: answers on the left with the robot, the visitor's on the right */
export default function AIMessageBubble({ from, text, file, typing }) {
  const ai = from === 'ai';
  return (
    <div className={'ai-msg ' + (ai ? 'from-ai' : 'from-user')}>
      {ai && <AIAvatar />}
      <div className="ai-bubble">
        {typing ? <span className="ai-typing" role="status" aria-label="Typing"><i /><i /><i /></span> : (
          <>
            {file && <span className="ai-file">📎 {file.name}</span>}
            {text}
          </>
        )}
      </div>
    </div>
  );
}
