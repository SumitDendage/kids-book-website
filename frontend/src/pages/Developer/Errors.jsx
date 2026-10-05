import Icon from '../../components/dashboard/Icon.jsx';
import { useDash } from '../Portal/DashContext.js';
import { log, fmt } from '../Portal/dashboard.js';
import { read } from '../../services/storage.js';

/* window.onerror and unhandled promise rejections, with their stack traces */
export default function Errors() {
  const { refresh } = useDash();
  const e = read('lww_errors', []).slice().reverse();
  const clear = () => { localStorage.removeItem('lww_errors'); log('cleared', 'lww_errors'); refresh(); };
  return (
    <section className="panel">
      <div className="row-between"><div><p className="eyebrow">Errors · {e.length}</p><p className="auth-sub">window.onerror and unhandled promise rejections land here.</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon id="trash" />Clear</button></div>
      {e.length ? <div>{e.map((x, i) => <details key={i} className="err-item"><summary><b>{x.msg}</b> <small>{fmt(x.at)}{x.file ? ' · ' + x.file.split('/').pop() + ':' + x.line : ''}</small></summary><pre className="code">{x.stack || 'no stack trace'}</pre></details>)}</div> : <p className="cart-empty">No errors caught.</p>}
    </section>
  );
}
