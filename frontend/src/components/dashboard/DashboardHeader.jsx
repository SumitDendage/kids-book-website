import Icon from './Icon.jsx';
import { ago } from '../../pages/Portal/dashboard.js';

/* the bell: the staff notifications this member may see (GET /api/admin/notifications) */
function Notes({ notes, open, onToggle, onNote, onReadAll }) {
  const n = notes.unread || 0;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-plain btn-ic hd-bell" aria-label={n ? 'Notifications, ' + n + ' unread' : 'Notifications'} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <Icon id="bell" size={18} />{n ? <span className="hd-dot">{n > 99 ? '99+' : n}</span> : null}
      </button>
      <div className={'menu notes-menu' + (open ? ' open' : '')} id="notesMenu" role="menu" aria-label="Notifications">
        <div className="notes-head"><b>Notifications</b>{n ? <button type="button" className="link" onClick={onReadAll}>Mark all as read</button> : null}</div>
        <div className="menu-sep" />
        {notes.error ? <p className="notes-empty">Notifications could not be loaded just now.</p>
          : !notes.list.length ? <p className="notes-empty">Nothing new. You are all caught up.</p>
            : notes.list.map(x => (
              <button key={x.id} type="button" role="menuitem" className={'note-item' + (x.read ? '' : ' unread')} onClick={() => onNote(x)}>
                <span className="note-dot" aria-hidden="true" />
                <span className="note-txt"><b>{x.title}</b>{x.body ? <small className="note-body">{x.body}</small> : null}<small>{ago(x.createdAt)}</small></span>
              </button>
            ))}
      </div>
    </>
  );
}

/* the h-16 header: sidebar toggle, top tabs, ⌘K search, notifications, theme toggle, the account menu */
export default function DashboardHeader({ kind, current, topnav, theme, initials, userBlock, menu, scrolled, other, notes, canNotes, onToggleSidebar, onGo, onSearch, onToggleTheme, onMenu, onSwitch, onBack, onSignOut, onPassword, onNote, onReadAll }) {
  return (
    <header className={'hd' + (scrolled ? ' scrolled' : '')}>
      <button type="button" className="btn btn-ghost btn-ic" aria-label="Toggle sidebar" style={{ width: '28px', height: '28px' }} onClick={onToggleSidebar}><Icon id="panel" /></button>
      <span className="vsep" />
      <nav className="topnav" aria-label="Sections">{topnav.map(([id, l]) => <button key={id} type="button" className={id === current ? 'on' : undefined} onClick={() => onGo(id)}>{l}</button>)}</nav>
      <span className="hd-spacer" />
      <button type="button" className="search-btn" onClick={onSearch} aria-label="Search sections"><Icon id="search" size={16} /><span>Search</span><kbd><span style={{ fontSize: '12px' }}>⌘</span>K</kbd></button>
      <div className="hd-right">
        {canNotes ? <Notes notes={notes} open={menu === 'notesMenu'} onToggle={onMenu('notesMenu')} onNote={onNote} onReadAll={onReadAll} /> : null}
        <button type="button" className="btn btn-ghost btn-plain btn-ic" aria-label="Toggle theme" onClick={onToggleTheme}><Icon id={theme === 'dark' ? 'moon' : 'sun'} size={18} /></button>
        <button type="button" className="av-btn" aria-label="Account" aria-haspopup="menu" aria-expanded={menu === 'profileMenu'} onClick={onMenu('profileMenu')}>{initials}</button>
      </div>
      <div className={'menu' + (menu === 'profileMenu' ? ' open' : '')} id="profileMenu" role="menu" style={{ right: '16px', top: '56px' }}>
        <div className="menu-label">{userBlock}</div><div className="menu-sep" />
        <button type="button" className="menu-item" role="menuitem" onClick={onPassword}><Icon id="key" />Change my password</button>
        {other ? <button type="button" className="menu-item" role="menuitem" onClick={() => onSwitch(kind === 'admin' ? 'developer' : 'admin')}><Icon id={kind === 'admin' ? 'api' : 'overview'} />{kind === 'admin' ? 'Developer panel' : 'Admin panel'}</button> : null}
        <button type="button" className="menu-item" role="menuitem" onClick={onBack}><Icon id="home" />Back to the site</button>
        <div className="menu-sep" />
        <button type="button" className="menu-item danger" role="menuitem" onClick={onSignOut}><Icon id="logout" />Sign out</button>
      </div>
    </header>
  );
}
