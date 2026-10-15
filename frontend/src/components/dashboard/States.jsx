import Icon from './Icon.jsx';
import { problem, NO_PERMISSION } from '../../pages/Portal/dashboard.js';

/* "Loading…" while the server answers (a few grey lines in the card's shape) */
export function Loading({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="ld" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="ld-line" style={{ width: (92 - i * 17) + '%' }} />)}
    </div>
  );
}

/* the server could not answer (or said no): what happened, in plain words, and Try again */
export function ErrorNote({ error, onRetry, compact }) {
  if (!error) return null;
  const denied = error.status === 403 && error.code !== 'owner_only';
  return (
    <div className={'st-note ' + (denied ? 'warn' : 'err') + (compact ? ' compact' : '')} role="alert">
      <Icon id={denied ? 'lock' : 'alert'} size={16} />
      <span>{denied ? NO_PERMISSION : problem(error)}</span>
      {onRetry && !denied ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry()}><Icon id="refresh" size={14} />Try again</button> : null}
    </div>
  );
}

/* a section's whole body: the error, the loading lines, or the content */
export function Guard({ state, children, rows }) {
  if (state.error && !state.data) return <section className="panel"><ErrorNote error={state.error} onRetry={state.reload} /></section>;
  if (state.loading && !state.data) return <section className="panel"><Loading rows={rows} /></section>;
  return children;
}
