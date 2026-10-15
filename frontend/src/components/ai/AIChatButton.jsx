import logo from '../../assets/logo-emblem.png';

/* the round logo button at the bottom right; it steps aside while the chat is open */
export default function AIChatButton({ ref, open, unread, onClick }) {
  return (
    <button
      ref={ref} type="button" className={'ai-fab' + (open ? ' is-hidden' : '')}
      aria-label="Ask AI" aria-haspopup="dialog" aria-expanded={open} aria-controls="ai-chat" tabIndex={open ? -1 : 0}
      onClick={onClick}
      onKeyDown={e => e.stopPropagation()}   /* Space and Enter press the button, they do not turn the chapter */
    >
      <img src={logo} alt="" draggable="false" />
      {unread && <span className="ai-fab-dot" aria-hidden="true" />}
      <span className="ai-fab-tip" aria-hidden="true">Ask AI</span>
    </button>
  );
}
