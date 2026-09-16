import { useRef, useState } from 'react';
import { useScrollFade } from '../../hooks/useScrollFade';
import { SplitWords } from '../ui/Motion';

/* Small pieces shared by every auth form; markup and class names match the
   original stylesheet so the look stays identical. */

export function Field({ id, label, error, children, style }) {
  return (
    <div className={'field' + (error ? ' bad' : '')} style={style}>
      <label htmlFor={id}>{label}</label>
      {children}
      <div className="err">{error || ''}</div>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button type="button" className="pw-toggle" onClick={() => setShow(s => !s)}>{show ? 'HIDE' : 'SHOW'}</button>
    </div>
  );
}

export function Alert({ alert }) {
  return <div className={'alert' + (alert ? ' show ' + alert.type : '')}>{alert ? alert.msg : ''}</div>;
}

export function Steps({ on }) {
  return (
    <div className="steps">
      {[0, 1, 2].map(i => <i key={i} className={i < on ? 'on' : ''} />)}
    </div>
  );
}

export function LinkButton({ onClick, children }) {
  return <button type="button" className="link" onClick={onClick}>{children}</button>;
}

/* One auth chapter: aside copy on the left, glass card on the right. */
export function AuthChapter({ view, active, aside, children }) {
  const inner = useRef(null);
  useScrollFade(inner);
  return (
    <section className={'chapter auth' + (active ? ' is-active in-fwd' : '')} data-auth={view}>
      <div className="chapter-inner" ref={inner}>
        <div className="auth-shell">
          <div className="auth-aside rise" style={{ '--i': 0 }}>
            <div className="badge">{aside.badge}</div>
            <SplitWords as="h2" text={aside.heading} delay={220} />
            <p>{aside.text}</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
