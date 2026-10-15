import { useState } from 'react';
import { StaffStyles, CardTable, Loading, LoadError, Note, NoAccess, PanelHead, Where, useStaffAccess, downloadFrom, problem, qs, count, bytes, ZONE_NAME, NO_PERMISSION } from './common.jsx';

/* Developer → Backups: the shop's settings as one file (owner or admin) and spreadsheet (CSV)
   exports of the records, straight from the server. Each needs exports.run plus the permission
   that shows that data on screen. Nothing is restored or deleted from this page: the database
   itself is backed up by Supabase. */

const EXPORTS = [
  ['orders', 'Orders', 'Every order with what was bought, the total in rupees and the currency paid', ['orders.read']],
  ['payments', 'Payments', 'Payments the gateways confirmed, with the order’s rupee total', ['orders.read', 'logs.read']],
  ['customers', 'Customers', 'Customer accounts with orders, spend and warnings (never passwords)', ['customers.read']],
  ['entitlements', 'Access records', 'What each customer may open, and until when', ['orders.read', 'customers.read', 'entitlements.grant', 'entitlements.revoke']],
  ['messages', 'Contact messages', 'Notes sent through the contact form', ['messages.read']],
  ['coupons', 'Coupons', 'Coupon codes and how often each was used', ['coupons.write', 'pricing.write', 'orders.read']],
  ['audit', 'Staff audit log', 'Everything staff changed, with who and when', ['audit.read']],
];

export default function Backups() {
  const access = useStaffAccess();
  const canExport = access.can('exports.run');
  const canBackup = canExport && (access.role === 'owner' || access.role === 'admin');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({});
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canExport) return <><StaffStyles /><NoAccess title="Backups and exports" need="exports.run" /></>;

  const badRange = from && to && from > to;
  async function get(key, path, fallback) {
    setBusy(key); setNotes(n => Object.assign({}, n, { [key]: null }));
    try {
      const out = await downloadFrom(path, fallback);
      const rows = out.rows != null ? ' with ' + count(out.rows) + (out.rows === 1 ? ' row' : ' rows') : '';
      setNotes(n => Object.assign({}, n, { [key]: { tone: 'ok', msg: 'Saved ' + out.name + rows + ' (' + bytes(out.size) + ').' + (out.truncated ? ' Only the first 25,000 rows fit: choose a shorter date range for the rest.' : '') } }));
    } catch (err) {
      setNotes(n => Object.assign({}, n, { [key]: { tone: 'err', msg: problem(err) } }));
    } finally { setBusy(null); }
  }

  return (
    <>
      <StaffStyles />
      <section className="panel" aria-labelledby="lwBakTitle" data-section="backup">
        <PanelHead id="lwBakTitle" title="Settings backup" sub="One file with the shop’s set-up: settings, plans, classes, sheet details, coupons, help answers, home page words, sharing rules and staff roles." />
        <Note tone="neutral">It never holds accounts, sign-ins, orders, payments, logs, the text of emails or any key or password. PDF files are not inside it either; they stay in storage.</Note>
        {canBackup ? (
          <div className="lw-actions">
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => get('backup', '/api/admin/backup', 'lww-backup.json')} data-act="download-backup">{busy === 'backup' ? <><span className="lw-spin" aria-hidden="true" />Preparing…</> : 'Download settings backup'}</button>
          </div>
        ) : <Note tone="neutral">{NO_PERMISSION} Only the owner or an admin can download the settings backup.</Note>}
        {notes.backup ? <Note tone={notes.backup.tone}>{notes.backup.msg}</Note> : null}
      </section>

      <section className="panel" aria-labelledby="lwExpTitle" data-section="exports">
        <PanelHead id="lwExpTitle" title="Export to a spreadsheet" sub="CSV files that open in Excel, Numbers or Google Sheets. Newest first, up to 25,000 rows each." />
        <div className="lw-filters">
          <div className="field"><label htmlFor="lwExpFrom">From (optional)</label><input id="lwExpFrom" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="lwExpTo">To (optional)</label><input id="lwExpTo" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          {from || to ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</button> : null}
        </div>
        <p className="lw-small">{from || to ? 'Dates are whole days in your time zone (' + ZONE_NAME + ').' : 'Leave the dates empty to export everything.'}</p>
        {badRange ? <Note tone="err">The From date is after the To date.</Note> : null}
        <CardTable caption="Exports" rows={EXPORTS} rowKey={r => r[0]} rowProps={r => ({ 'data-export': r[0] })} cols={[
          ['Export', ([, label, help]) => <span className="lw-who"><span><b>{label}</b><small>{help}</small></span></span>],
          ['', ([kind, label, , perms]) => {
            const allowed = access.canAny(perms);
            if (!allowed) return <span className="lw-small">Needs {perms.map(p => '“' + p + '”').join(' or ')}</span>;
            return (
              <span className="lw-stack" style={{ gap: 6, justifyItems: 'end' }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || badRange} data-act={'export-' + kind}
                  onClick={() => get(kind, '/api/admin/export/' + kind + qs({ from, to, tz: from || to ? ZONE_NAME : '' }), 'lww-' + kind + '.csv')}>
                  {busy === kind ? <><span className="lw-spin" aria-hidden="true" />Preparing…</> : 'Download ' + label.toLowerCase()}
                </button>
                {notes[kind] ? <span className={'lw-small'} role={notes[kind].tone === 'err' ? 'alert' : 'status'} style={{ color: notes[kind].tone === 'err' ? 'var(--bad)' : 'var(--ok)' }}>{notes[kind].msg}</span> : null}
              </span>
            );
          }],
        ]} />
        <p className="lw-small">Each download is written to the staff audit log. At most 30 exports an hour per person.</p>
      </section>

      <section className="panel" aria-labelledby="lwDbBak">
        <PanelHead id="lwDbBak" title="Database backups" />
        <Note tone="info">
          <p>Accounts, orders, payments and logs are kept safe by Supabase’s own database backups (how many days are kept depends on the Supabase plan). See them, and restore one if ever needed, under <Where>Supabase dashboard → Database → Backups</Where>.</p>
          <p>Restoring replaces the live data, so it is never done from this page.</p>
        </Note>
      </section>
    </>
  );
}
