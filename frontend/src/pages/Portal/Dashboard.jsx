import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../components/dashboard/Sidebar.jsx';
import DashboardHeader from '../../components/dashboard/DashboardHeader.jsx';
import CommandMenu from '../../components/dashboard/CommandMenu.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { DashContext } from './DashContext.js';
import { ADMIN } from '../Admin/index.js';
import { DEV } from '../Developer/index.js';
import { GROUPS, DESC, TOPNAV, FIRST, sectionsOf, canWith, sectionAllowed, panelAllowed, initialsOf, ROLE_LABEL, canExport, exportCsv, EXPORTS, canBackup, downloadBackup, problem, tzName, qs } from './dashboard.js';
import { read, write } from '../../services/storage.js';
import { staffApi, authApi } from '../../services/api.js';
import { SITE_VERSION } from '../../data/content.js';

/* which section each panel shows, kept while the staff page is closed and reopened */
const sectionOf = { admin: 'overview', developer: 'health' };
/* where a staff notification leads (by the first part of its kind) */
const NOTE_SECTION = { order: 'orders', payment: 'orders', refund: 'orders', contact: 'messages', message: 'messages', security: 'security', appeal: 'security', access: 'security', warning: 'security', incident: 'security', review: 'content', staff: 'roles' };
const NOTE_PERMS = ['dashboard.view', 'orders.read', 'messages.read', 'security.read', 'reviews.moderate', 'emails.read', 'staff.manage'];

/* a section that throws shows a note instead of taking the whole panel down */
class SectionBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.section !== this.props.section && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? <section className="panel"><div className="st-note err" role="alert"><Icon id="alert" size={16} /><span>This section could not be shown ({this.state.err.message}). Try another section, or reload the page.</span></div></section> : this.props.children; }
}

/* the buttons at the top right of a section: exports, the backup, a new book */
function HeadActions({ kind, cur, can, me, actions, busy }) {
  const exp = (k, label) => (canExport(k, can) ? <button key={k} type="button" className="btn btn-ghost" disabled={busy === k} onClick={() => actions.exportCsv(k)}><Icon id="download" />{busy === k ? 'Preparing…' : (label || 'Export')}</button> : null);
  const backup = label => (canBackup(me, can) ? <button type="button" className="btn btn-primary" disabled={busy === 'backup'} onClick={actions.backup} title="Settings, prices, products, coupons and site text as one file"><Icon id="download" />{busy === 'backup' ? 'Preparing…' : label}</button> : null);
  if (kind === 'admin') {
    if (cur === 'overview') return backup('Download backup');
    if (cur === 'products') return can('catalogue.write') ? <button type="button" className="btn btn-primary" onClick={actions.newProduct}><Icon id="plus" />Upload new book</button> : null;
    if (cur === 'orders') return <>{exp('payments', 'Export payments')}{exp('orders')}</>;
    if (cur === 'customers') return <>{exp('entitlements', 'Export access')}{exp('customers')}</>;
    if (cur === 'messages') return exp('messages');
    if (cur === 'coupons') return exp('coupons');
    if (cur === 'analytics') return exp('payments', 'Export payments');
    if (cur === 'audit') return exp('audit');
    return null;
  }
  if (cur === 'backups') return backup('Download backup');
  if (cur === 'payments') return exp('payments', 'Export payments');
  if (cur === 'audit') return exp('audit');
  return null;
}

/* The staff dashboard (shadcn-admin look): sidebar, header, the section, footer.
   `me` is the server's answer to GET /api/admin/me; only sections it allows are shown. */
export default function Dashboard({ kind, me, site, portalRef, onSwitch, onBack, onSignOut, authLost, reloadMe }) {
  const { toast } = site;
  const can = useMemo(() => canWith(me), [me]);
  const secs = sectionsOf(kind);
  const allowed = useCallback(id => sectionAllowed(kind, id, can), [kind, can]);
  const firstAllowed = (secs.find(([id]) => allowed(id)) || [FIRST[kind]])[0];
  const [cur, setCur] = useState(() => (allowed(sectionOf[kind]) ? sectionOf[kind] : firstAllowed));
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const [editing, setEditing] = useState(null);
  const [custOpen, setCustOpen] = useState(null);
  const [focus, setFocus] = useState(null);   /* { order } | { customer } | { message } from a notification */
  const [theme, setTheme] = useState(() => read('lww_dash_theme', 'light'));
  const [collapsed, setCollapsed] = useState(() => read('lww_dash_sb', false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(null);   /* 'userMenu' | 'profileMenu' | 'notesMenu' | null */
  const [palette, setPalette] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [busy, setBusy] = useState(null);
  const [stats, setStats] = useState(null);
  const [notes, setNotes] = useState({ list: [], unread: 0, error: null });
  /* another panel: its own last section; permissions changed: leave a section that is no longer allowed */
  useEffect(() => { setCur(allowed(sectionOf[kind]) ? sectionOf[kind] : firstAllowed); setEditing(null); setCustOpen(null); setFocus(null); }, [kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!allowed(cur)) { setCur(firstAllowed); setEditing(null); } }, [allowed, cur, firstAllowed]);

  const label = id => (secs.find(x => x[0] === id) || [])[1] || id;
  const go = useCallback((id, focusOn) => {
    setMenu(null); setPalette(false);
    if (!allowed(id)) { toast('You do not have permission for this.'); return; }
    sectionOf[kind] = id; setCur(id); setEditing(null); setCustOpen(null); setMobileOpen(false); setFocus(focusOn || null);
    if (portalRef.current) portalRef.current.scrollTop = 0;
  }, [kind, toast, allowed, portalRef]);
  const search = useCallback(() => { setMenu(null); setPalette(true); }, []);

  /* sidebar badges and the bell: real numbers from the server, asked again every minute */
  const canNotes = can(NOTE_PERMS);
  const refreshCounts = useCallback(() => {
    if (can('dashboard.view')) staffApi('GET', '/api/admin/stats' + qs({ tz: tzName() })).then(setStats).catch(e => { if (e.status === 401) authLost(); });
    if (canNotes) staffApi('GET', '/api/admin/notifications?limit=8').then(r => setNotes({ list: r.notifications || [], unread: r.unread || 0, error: null })).catch(e => { if (e.status === 401) authLost(); else setNotes(n => ({ ...n, error: e })); });
  }, [can, canNotes, authLost]);
  useEffect(() => {
    refreshCounts();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshCounts(); }, 60e3);
    return () => clearInterval(t);
  }, [refreshCounts]);

  /* ⌘K opens the section search */
  useEffect(() => {
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMenu(null); setPalette(p => !p); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  /* Escape closes an open menu (or the phone sidebar) and nothing else: it is caught before the
     site's own Escape, which would close the whole staff page */
  const openRef = useRef({ menu: null, mobileOpen: false });
  useEffect(() => { openRef.current = { menu, mobileOpen }; }, [menu, mobileOpen]);
  useEffect(() => {
    const onEsc = e => {
      if (e.key !== 'Escape') return;
      const o = openRef.current;
      if (!o.menu && !o.mobileOpen) return;
      e.preventDefault(); e.stopPropagation();
      if (o.menu) setMenu(null); else setMobileOpen(false);
    };
    addEventListener('keydown', onEsc, true);
    return () => removeEventListener('keydown', onEsc, true);
  }, []);
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

  const failed = useCallback(e => { if (e && e.status === 401) authLost(e); else toast(problem(e)); }, [authLost, toast]);
  const actions = useMemo(() => ({
    newProduct: () => { sectionOf[kind] = 'products'; setEditing('new'); },
    exportCsv: async k => {
      setBusy(k);
      try { const r = await exportCsv(k); toast(r.rows != null ? 'Downloaded ' + r.rows + ' ' + EXPORTS[k].label + (r.truncated ? ' (the first ones only)' : '') : 'Downloaded ' + r.name); }
      catch (e) { failed(e); }
      setBusy(null);
    },
    backup: async () => {
      setBusy('backup');
      try { const r = await downloadBackup(); toast('Downloaded ' + r.name); } catch (e) { failed(e); }
      setBusy(null);
    },
  }), [kind, toast, failed]);

  const openNote = n => {
    setMenu(null);
    if (!n.read) {
      setNotes(s => ({ ...s, list: s.list.map(x => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, s.unread - 1) }));
      staffApi('POST', '/api/admin/notifications/read', { ids: [n.id] }).catch(e => { if (e.status === 401) authLost(); });
    }
    const sec = NOTE_SECTION[String(n.kind || '').split('.')[0]];
    const d = n.data || {};
    if (kind === 'admin' && sec && allowed(sec)) go(sec, d.orderId ? { order: d.orderId } : d.userId ? { customer: d.userId } : null);
  };
  const readAll = () => {
    setNotes(s => ({ ...s, list: s.list.map(x => ({ ...x, read: true })), unread: 0 }));
    staffApi('POST', '/api/admin/notifications/read', { all: true }).then(refreshCounts).catch(failed);
  };
  const changePassword = async () => {
    setMenu(null);
    try { await authApi.forgotPassword({ email: me.user.email }); toast('We emailed you a link to choose a new password.'); }
    catch (e) { toast(e.code === 'mail_unavailable' ? 'The server cannot send email just now. Please try again later.' : problem(e)); }
  };

  const counts = kind === 'admin' && stats ? {
    messages: can('messages.read') ? stats.messages_unread || 0 : 0,
    security: can('security.read') ? (stats.openIncidents || 0) + (stats.openAppeals || 0) : 0,
    content: can('reviews.moderate') ? stats.pendingReviews || 0 : 0,
  } : {};
  const name = me.user.name || me.user.email.split('@')[0], email = me.user.email, ini = initialsOf(name);
  const roleName = ROLE_LABEL[me.staff.role] || me.staff.role;
  const userBlock = <><span className="av">{ini}</span><span className="team-txt"><b>{name}</b><small>{roleName} · {email}</small></span></>;
  const other = kind === 'admin' ? panelAllowed('developer', can) : panelAllowed('admin', can);
  const Section = (kind === 'admin' ? ADMIN : DEV)[cur] || (() => null);
  const switchTo = k => { setMenu(null); onSwitch(k); };
  const back = () => { setMenu(null); onBack(); };
  const out = () => { setMenu(null); onSignOut(); };
  const groupOf = id => (GROUPS[kind].find(([, ids]) => ids.includes(id)) || [''])[0];
  const paletteItems = secs.filter(([id]) => allowed(id)).map(([id, l]) => ({ key: id, id, label: l, group: groupOf(id) }));
  const ctx = {
    kind, me, who: me, can, allowed, site, toast, go, refresh, tick, editing, setEditing, custOpen, setCustOpen, portalRef,
    authLost, reloadMe, refreshCounts, stats, focus, clearFocus: () => setFocus(null),
  };

  return (
    <DashContext.Provider value={ctx}>
      <div className={'dash' + (theme === 'dark' ? ' dark' : '') + (collapsed ? ' sb-collapsed' : '') + (mobileOpen ? ' sb-open' : '')}>
        <div className="sb-scrim" onClick={() => setMobileOpen(false)} />
        <Sidebar kind={kind} current={cur} groups={GROUPS[kind]} label={label} allowed={allowed} counts={counts} first={firstAllowed} other={other} onGo={go} onSwitch={switchTo} onBack={back} userBlock={userBlock} onUserMenu={openMenu('userMenu')} />
        <div className="inset">
          <DashboardHeader kind={kind} current={cur} topnav={TOPNAV[kind].filter(([id]) => allowed(id))} theme={theme} initials={ini} userBlock={userBlock} menu={menu} scrolled={scrolled} other={other} notes={notes} canNotes={canNotes}
            onToggleSidebar={toggleSidebar} onGo={go} onSearch={search} onToggleTheme={toggleTheme} onMenu={openMenu} onSwitch={switchTo} onBack={back} onSignOut={out} onPassword={changePassword} onNote={openNote} onReadAll={readAll} />
          <div className={'menu user-menu' + (menu === 'userMenu' ? ' open' : '')} id="userMenu" role="menu">
            <div className="menu-label">{userBlock}</div><div className="menu-sep" />
            <button type="button" className="menu-item" role="menuitem" onClick={changePassword}><Icon id="key" />Change my password</button>
            <button type="button" className="menu-item" role="menuitem" onClick={back}><Icon id="home" />Back to the site</button>
            <div className="menu-sep" />
            <button type="button" className="menu-item danger" role="menuitem" onClick={out}><Icon id="logout" />Sign out</button>
          </div>
          <main className="mn">
            <div className="mn-head"><div><h1>{label(cur)}</h1><p>{DESC[kind][cur] || ''}</p></div><div className="mn-actions"><HeadActions kind={kind} cur={cur} can={can} me={me} actions={actions} busy={busy} /></div></div>
            <SectionBoundary section={kind + cur}><Section key={kind + cur} /></SectionBoundary>
          </main>
          <footer className="ft"><span>Learn With Why · {kind === 'admin' ? 'Admin' : 'Developer'} · v{SITE_VERSION}</span><span>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></footer>
        </div>
        {palette ? <CommandMenu items={paletteItems} onPick={it => go(it.id)} onClose={() => setPalette(false)} /> : null}
      </div>
    </DashContext.Provider>
  );
}
