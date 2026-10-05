import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from '../../components/dashboard/Sidebar.jsx';
import DashboardHeader from '../../components/dashboard/DashboardHeader.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { DashContext } from './DashContext.js';
import { ADMIN } from '../Admin/index.js';
import { DEV } from '../Developer/index.js';
import { GROUPS, DESC, TOPNAV, FIRST, sectionsOf, permsOf, orders, staffName, staffEmail, initialsOf, syncFromServer, downloadBackup } from './dashboard.js';
import { read, write } from '../../services/storage.js';
import { SITE_VERSION } from '../../data/content.js';

/* which section each panel shows, kept while the staff page is closed and reopened */
const sectionOf = { admin: 'overview', developer: 'health' };

/* a section that throws shows a note instead of taking the whole panel down */
class SectionBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.section !== this.props.section && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? <section className="panel"><p className="cart-empty">Could not render this section: {this.state.err.message}</p></section> : this.props.children; }
}

function HeadActions({ kind, cur, go }) {
  const exp = <button type="button" className="btn btn-ghost" onClick={downloadBackup}><Icon id="download" />Export</button>;
  if (kind === 'admin' && cur === 'overview') return <button type="button" className="btn btn-primary" onClick={downloadBackup}>Download</button>;
  if (cur === 'products') return <>{exp}<button type="button" className="btn btn-primary" onClick={() => go.newProduct()}><Icon id="plus" />Upload new book</button></>;
  if (cur === 'customers' || cur === 'orders' || cur === 'audit' || cur === 'analytics') return exp;
  if (cur === 'backups') return <button type="button" className="btn btn-primary" onClick={downloadBackup}><Icon id="download" />Download backup</button>;
  if (cur === 'errors') return <button type="button" className="btn btn-ghost" onClick={go.throwTest}>Throw a test error</button>;
  return null;
}

/* The staff dashboard (shadcn-admin look): sidebar, header, the section, footer. */
export default function Dashboard({ kind, who, site, portalRef, onSwitch, onBack, onSignOut }) {
  const { toast } = site;
  const [cur, setCur] = useState(sectionOf[kind]);
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const [editing, setEditing] = useState(null);
  const [custOpen, setCustOpen] = useState(null);
  const [theme, setTheme] = useState(() => read('lww_dash_theme', 'light'));
  const [collapsed, setCollapsed] = useState(() => read('lww_dash_sb', false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(null);   /* 'userMenu' | 'profileMenu' | null */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { setCur(sectionOf[kind]); setEditing(null); setCustOpen(null); }, [kind]);

  const secs = sectionsOf(kind), perms = permsOf(who);
  const label = id => (secs.find(x => x[0] === id) || [])[1] || id;
  const allowed = id => perms.includes(id) || kind === 'developer' || id === 'overview' || id === 'settings';
  const go = useCallback(id => {
    setMenu(null);
    if (!allowed(id)) { toast('Your role does not have this permission'); return; }
    sectionOf[kind] = id; setCur(id); setEditing(null); setCustOpen(null); setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, toast, perms.join()]);
  /* ⌘K / the Search button: jump to a section by name */
  const search = useCallback(() => {
    setMenu(null);
    const q = prompt('Jump to a section (e.g. orders, customers, errors):'); if (!q) return;
    const t = q.trim().toLowerCase(), hit = secs.find(([id, l]) => id === t || l.toLowerCase().includes(t));
    if (hit) { sectionOf[kind] = hit[0]; setCur(hit[0]); setEditing(null); setCustOpen(null); } else toast('No section called "' + t + '"');
  }, [secs, kind, toast]);

  /* the database is the source of truth: pull it (at most every 30 s) and redraw if anything came back */
  useEffect(() => { let alive = true; syncFromServer().then(changed => { if (changed && alive) refresh(); }); return () => { alive = false; }; });
  /* ⌘K, and Escape closes an open menu */
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search(); }
      if (e.key === 'Escape') setMenu(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [search]);
  /* a click anywhere outside a menu closes it */
  useEffect(() => {
    if (!menu) return undefined;
    const onClick = e => { if (!e.target.closest('.dash .menu')) setMenu(null); };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menu]);
  /* header shadow once the page scrolls */
  useEffect(() => {
    const el = portalRef.current; if (!el) return undefined;
    const sc = () => setScrolled((el.scrollTop || 0) > 10);
    el.addEventListener('scroll', sc, { passive: true }); sc();
    return () => el.removeEventListener('scroll', sc);
  }, [portalRef]);

  const toggleSidebar = () => { if (innerWidth < 768) setMobileOpen(o => !o); else setCollapsed(c => { write('lww_dash_sb', !c); return !c; }); };
  const toggleTheme = () => setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; write('lww_dash_theme', n); return n; });
  const openMenu = id => e => { e.stopPropagation(); setMenu(m => (m === id ? null : id)); };
  const actions = useMemo(() => ({
    newProduct: () => { sectionOf[kind] = 'products'; setEditing('new'); },
    throwTest: () => { setTimeout(() => { throw new Error('Test error from the developer panel'); }, 0); setTimeout(refresh, 300); },
  }), [kind, refresh]);

  const counts = { orders: orders().filter(o => o.status === 'pending').length, messages: read('lww_messages', []).filter(m => !m.read).length, errors: read('lww_errors', []).length, security: read('lww_security', []).length };
  const name = staffName(), email = staffEmail(), ini = initialsOf(name);
  const userBlock = <><span className="av">{ini}</span><span className="team-txt"><b>{name}</b><small>{email}</small></span></>;
  const Section = (kind === 'admin' ? ADMIN : DEV)[cur] || (() => null);
  const switchTo = k => { setMenu(null); onSwitch(k); };
  const back = () => { setMenu(null); onBack(); };
  const out = () => { setMenu(null); onSignOut(); };
  const ctx = { kind, who, site, toast, go, refresh, editing, setEditing, custOpen, setCustOpen, portalRef };

  return (
    <DashContext.Provider value={ctx}>
      <div className={'dash' + (theme === 'dark' ? ' dark' : '') + (collapsed ? ' sb-collapsed' : '') + (mobileOpen ? ' sb-open' : '')}>
        <div className="sb-scrim" onClick={() => setMobileOpen(false)} />
        <Sidebar kind={kind} current={cur} groups={GROUPS[kind]} label={label} allowed={allowed} counts={counts} first={FIRST[kind]} onGo={go} onSwitch={switchTo} onBack={back} userBlock={userBlock} onUserMenu={openMenu('userMenu')} />
        <div className="inset">
          <DashboardHeader kind={kind} current={cur} topnav={TOPNAV[kind]} theme={theme} initials={ini} userBlock={userBlock} menuOpen={menu === 'profileMenu'} scrolled={scrolled}
            onToggleSidebar={toggleSidebar} onGo={go} onSearch={search} onToggleTheme={toggleTheme} onMenu={openMenu('profileMenu')} onSwitch={switchTo} onBack={back} onSignOut={out} />
          <div className={'menu user-menu' + (menu === 'userMenu' ? ' open' : '')} id="userMenu" role="menu">
            <div className="menu-label">{userBlock}</div><div className="menu-sep" />
            <button type="button" className="menu-item" role="menuitem" onClick={() => go(kind === 'admin' ? 'roles' : 'health')}><Icon id="roles" />Account</button>
            <button type="button" className="menu-item" role="menuitem" onClick={back}><Icon id="home" />Back to the site</button>
            <div className="menu-sep" />
            <button type="button" className="menu-item danger" role="menuitem" onClick={out}><Icon id="logout" />Sign out</button>
          </div>
          <main className="mn">
            <div className="mn-head"><div><h1>{label(cur)}</h1><p>{DESC[cur] || ''}</p></div><div className="mn-actions"><HeadActions kind={kind} cur={cur} go={actions} /></div></div>
            <SectionBoundary section={kind + cur}><Section /></SectionBoundary>
          </main>
          <footer className="ft"><span>Learn With Why · {kind === 'admin' ? 'Admin' : 'Developer'} · v{SITE_VERSION}</span><span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></footer>
        </div>
      </div>
    </DashContext.Provider>
  );
}
