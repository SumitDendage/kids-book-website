import Icon from './Icon.jsx';

/* the h-16 header: sidebar toggle, top tabs, ⌘K search, theme toggle, the account menu */
export default function DashboardHeader({ kind, current, topnav, theme, initials, userBlock, menuOpen, scrolled, onToggleSidebar, onGo, onSearch, onToggleTheme, onMenu, onSwitch, onBack, onSignOut }) {
  return (
    <header className={'hd' + (scrolled ? ' scrolled' : '')}>
      <button type="button" className="btn btn-ghost btn-ic" aria-label="Toggle sidebar" style={{ width: '28px', height: '28px' }} onClick={onToggleSidebar}><Icon id="panel" /></button>
      <span className="vsep" />
      <nav className="topnav" aria-label="Sections">{topnav.map(([id, l]) => <button key={id} type="button" className={id === current ? 'on' : undefined} onClick={() => onGo(id)}>{l}</button>)}</nav>
      <span className="hd-spacer" />
      <button type="button" className="search-btn" onClick={onSearch}><Icon id="search" size={16} /><span>Search</span><kbd><span style={{ fontSize: '12px' }}>⌘</span>K</kbd></button>
      <div className="hd-right">
        <button type="button" className="btn btn-ghost btn-plain btn-ic" aria-label="Toggle theme" onClick={onToggleTheme}><Icon id={theme === 'dark' ? 'moon' : 'sun'} size={18} /></button>
        <button type="button" className="av-btn" aria-label="Account" aria-haspopup="menu" aria-expanded={menuOpen} onClick={onMenu}>{initials}</button>
      </div>
      <div className={'menu' + (menuOpen ? ' open' : '')} id="profileMenu" role="menu" style={{ right: '16px', top: '56px' }}>
        <div className="menu-label">{userBlock}</div><div className="menu-sep" />
        <button type="button" className="menu-item" role="menuitem" onClick={() => onGo(kind === 'admin' ? 'roles' : 'health')}><Icon id="roles" />Account</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onSwitch(kind === 'admin' ? 'developer' : 'admin')}><Icon id={kind === 'admin' ? 'api' : 'overview'} />{kind === 'admin' ? 'Developer panel' : 'Admin panel'}</button>
        <button type="button" className="menu-item" role="menuitem" onClick={onBack}><Icon id="home" />Back to the site</button>
        <div className="menu-sep" />
        <button type="button" className="menu-item danger" role="menuitem" onClick={onSignOut}><Icon id="logout" />Sign out</button>
      </div>
    </header>
  );
}
