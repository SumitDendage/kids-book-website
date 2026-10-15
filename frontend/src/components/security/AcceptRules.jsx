import { DEFAULT_AGREEMENT } from '../../services/security.js';

/* The required "my account is personal" box on the sign-up form (and when the rules change and
   must be accepted again). The words come from the server (GET /api/config, or the 403 that asks
   for them again); the form owns the ticked state and keeps its button disabled until it is ticked. */
export default function AcceptRules({ id = 'auAccept', text = DEFAULT_AGREEMENT.text, checked, onChange, error }) {
  return (
    <div className={'accept-rules' + (checked ? ' on' : '') + (error ? ' bad' : '')}>
      <label className="accept-check" htmlFor={id}>
        <input id={id} type="checkbox" required aria-required="true" checked={checked} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? id + 'Err' : undefined} onChange={e => onChange(e.target.checked)} />
        <span>{text}</span>
      </label>
      {error ? <div className="err" id={id + 'Err'} role="alert">{error}</div> : null}
    </div>
  );
}
