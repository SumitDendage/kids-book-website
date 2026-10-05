import { useState } from 'react';
import { useDash } from '../Portal/DashContext.js';
import { save, log, fmt, adminKey, sync, syncFromServer } from '../Portal/dashboard.js';

/* the server connection (admin key) — access never expires, so there is nothing to time.
   The key is typed in here by staff and kept in this browser; it is never built into the site. */
export default function Settings() {
  const { toast, refresh } = useDash();
  const [status, setStatus] = useState(() => (adminKey() ? (sync.at ? 'Connected · synced ' + fmt(sync.at) : 'Key saved') : 'Not connected'));
  const submit = async e => {
    e.preventDefault();
    const key = String(new FormData(e.currentTarget).get('key') || '').trim();
    save('lww_admin_key', key); log('admin key ' + (key ? 'saved' : 'cleared'), '');
    if (!key) { setStatus('Not connected'); return; }
    setStatus('Connecting…');
    const ok = await syncFromServer(true);
    setStatus(ok ? 'Connected · synced ' + fmt(sync.at) : 'Could not connect — check the key and that the server is running');
    toast(ok ? 'Orders, customers and entitlements loaded from the database' : 'Server refused the key');
    if (ok) refresh();
  };
  return (
    <>
      <section className="panel"><p className="eyebrow">Server connection</p><p className="auth-sub">With the admin key saved here, Orders, Customers and the dashboard read the database (SQLite behind <code>/api/admin/*</code>) instead of this browser&apos;s copy, and order status changes are written back.</p>
        <form className="grid-2" style={{ gap: '24px' }} onSubmit={submit}>
          <div>
            <div className="field"><label htmlFor="adminKey">Admin key</label><input id="adminKey" name="key" type="password" defaultValue={adminKey()} placeholder="ADMIN_KEY from site/.env" autoComplete="off" /><small>Set <code>ADMIN_KEY</code> in <code>site/.env</code> (the default is <code>change-me</code>) and enter the same value here.</small></div>
            <div className="btn-row"><button type="submit" className="btn btn-primary">Save &amp; connect</button><span className="note" role="status" style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>{status}</span></div>
          </div>
          <div>
            <div className="field"><label>Access</label><div className="tbl-wrap" style={{ padding: '14px 16px', fontSize: '14px', lineHeight: 1.6 }}>Every sheet a customer opens for free or pays for stays on their account — <b>there is no expiry</b>. To take a sheet away from one customer, revoke its entitlement with <code>POST /api/admin/entitlements/revoke</code>; an open viewer closes within a minute.</div></div>
          </div>
        </form>
      </section>
      <section className="panel"><p className="eyebrow">What the customer sees</p><p className="auth-sub">Right after a successful purchase:</p>
        <div className="tbl-wrap" style={{ padding: '16px 18px', fontSize: '14px', lineHeight: 1.6 }}><b>Your purchase has been completed successfully.</b> You can now access your PDF.<br />This worksheet has been added to your account — it is yours to keep, with no expiry.<br />You can open it any time from <b>My Account → My Worksheets</b>.</div>
      </section>
    </>
  );
}
