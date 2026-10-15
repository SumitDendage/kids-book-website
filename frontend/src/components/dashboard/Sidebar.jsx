import Icon from './Icon.jsx';

/* the collapsible icon sidebar: team button, grouped sections with badges, the other panel, back to the site, the user.
   Only the sections this staff member may open are listed (groups left empty are dropped). */
export default function Sidebar({ kind, current, groups, label, allowed, counts, first, other, onGo, onSwitch, onBack, userBlock, onUserMenu }) {
  const otherKind = kind === 'admin' ? 'developer' : 'admin', otherLabel = kind === 'admin' ? 'Developer panel' : 'Admin panel';
  const item = id => (
    <button key={id} type="button" className={'sb-item' + (id === current ? ' on' : '')} title={label(id)} aria-current={id === current ? 'page' : undefined} onClick={() => onGo(id)}>
      <Icon id={id} /><span>{label(id)}</span>{counts[id] ? <span className="sb-badge" aria-label={counts[id] + ' waiting'}>{counts[id] > 99 ? '99+' : counts[id]}</span> : null}
    </button>
  );
  const shown = groups.map(([g, ids]) => [g, ids.filter(allowed)]).filter(([, ids]) => ids.length);
  return (
    <aside className="sb" aria-label="Sidebar">
      <div className="sb-head"><button type="button" className="team" onClick={() => onGo(first)}><span className="team-logo">LW</span><span className="team-txt"><b>Learn With Why</b><small>{kind === 'admin' ? 'Admin panel' : 'Developer panel'}</small></span><span className="chev"><Icon id="chevrons" size={16} /></span></button></div>
      <div className="sb-content">
        {shown.map(([g, ids]) => <div key={g} className="sb-group"><div className="sb-label">{g}</div><nav className="sb-menu" aria-label={g}>{ids.map(item)}</nav></div>)}
        <div className="sb-group"><div className="sb-label">Other</div><nav className="sb-menu" aria-label="Other">
          {other ? <button type="button" className="sb-item" title={otherLabel} onClick={() => onSwitch(otherKind)}><Icon id={kind === 'admin' ? 'api' : 'overview'} /><span>{otherLabel}</span></button> : null}
          <button type="button" className="sb-item" title="Back to the site" onClick={onBack}><Icon id="home" /><span>Back to the site</span></button>
        </nav></div>
      </div>
      <div className="sb-foot"><button type="button" className="team sb-user" aria-haspopup="menu" onClick={onUserMenu}>{userBlock}<span className="chev"><Icon id="chevrons" size={16} /></span></button></div>
    </aside>
  );
}
