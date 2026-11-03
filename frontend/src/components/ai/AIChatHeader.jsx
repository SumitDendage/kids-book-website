import { AI_NAME } from '../../data/aiAssistant.js';
import { AIAvatar } from './AIMessageBubble.jsx';

/* robot, name, "Online", and the minimize and close buttons */
export default function AIChatHeader({ onMinimize, onClose }) {
  return (
    <header className="ai-head">
      <AIAvatar size="lg" />
      <div className="ai-head-text">
        <h2 id="ai-chat-title" className="ai-name">{AI_NAME}</h2>
        <p className="ai-status"><i aria-hidden="true" />Online</p>
      </div>
      <button type="button" className="icon-btn" aria-label="Minimize chat" title="Minimize" onClick={onMinimize}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
      </button>
      <button type="button" className="icon-btn" aria-label="Close chat" title="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>
  );
}
