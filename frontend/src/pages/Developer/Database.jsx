import { useState } from 'react';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { StaffStyles, CardTable, Chips, KV, Loading, LoadError, Note, NoAccess, PanelHead, Where, useServer, useStaffAccess, when, count, bytes, ms } from './common.jsx';

/* Developer → Database: the live database's tables with their size and about how many rows each
   holds, from GET /api/admin/developer/health. Nothing here comes from this browser. */

const TABLE_HELP = {
  access_log: 'Each time a sheet was opened, printed or downloaded', account_appeals: 'Notes customers sent about warnings or paused access',
  account_warnings: 'Warnings given for account sharing', agreement_acceptances: 'When customers accepted the terms', analytics_events: 'Visits and shop events for Analytics',
  app_sessions: 'Sign-ins, one per device or browser', audit_logs: 'Everything staff changed', auth_tokens: 'One-time links (only their fingerprints)',
  classes: 'Classes, Kindergarten to Class 3', contact_messages: 'Notes from the contact form', coupon_redemptions: 'Coupons used on orders', coupons: 'Coupon codes',
  delivery_counters: 'How often each sheet was delivered', email_outbox: 'Emails waiting, sent or failed', entitlements: 'What each customer may open, and until when',
  faq_entries: 'Answers for the help assistant', login_activity: 'Sign-in attempts', notifications: 'Notices for customers and staff', order_items: 'What each order contained',
  orders: 'Orders', payment_events: 'Notifications from the payment gateways', payments: 'Payments the gateways confirmed', plans: 'Subscription plans and prices',
  products: 'Worksheets and books', profiles: 'Customer and staff accounts', quotes: 'Prices quoted at checkout', reviews: 'Customer reviews',
  security_events: 'Account and security events', security_incidents: 'Possible account sharing the rules noticed', security_rules: 'The sharing rules',
  settings: 'Store settings', site_content: 'Words on the home page', staff_members: 'Staff and their roles', staff_permissions: 'The list of staff permissions',
  staff_role_templates: 'What each staff role may do',
};

export default function Database() {
  const access = useStaffAccess();
  const canRead = access.can('developer.read');
  const [sort, setSort] = useState('size');
  const { data, error, loading, reload } = useServer('/api/admin/developer/health', { skip: !canRead });
  if (!access.ready) return <section className="panel"><StaffStyles />{access.error ? <LoadError error={access.error} what="your staff permissions" /> : <Loading />}</section>;
  if (!canRead) return <><StaffStyles /><NoAccess title="Database" need="developer.read" /></>;

  const tables = data ? (data.tables || []).slice() : [];
  const total = tables.reduce((n, t) => n + (Number(t.bytes) || 0), 0);
  const rows = tables.reduce((n, t) => n + (Number(t.rows) || 0), 0);
  if (sort === 'size') tables.sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.name.localeCompare(b.name));
  else if (sort === 'rows') tables.sort((a, b) => (b.rows || 0) - (a.rows || 0) || a.name.localeCompare(b.name));
  else tables.sort((a, b) => a.name.localeCompare(b.name));
  const top = Math.max(1, ...tables.map(t => t.bytes || 0));
  const db = data ? data.db || {} : {};

  return (
    <>
      <StaffStyles />
      <div className="kpi-row">
        <MetricCard label="Tables" value={data ? count(tables.length) : '…'} sub="in the public schema" icon="db" />
        <MetricCard label="Rows" value={data ? 'About ' + count(rows) : '…'} sub="across every table" icon="activity" />
        <MetricCard label="Size on disk" value={data ? bytes(total) : '…'} sub="tables and their indexes" icon="backups" />
        <MetricCard label="Database answer" value={data ? ms(db.latencyMs) : '…'} sub="measured on the server" icon="clock" />
      </div>
      <section className="panel" aria-labelledby="lwDbTables" data-section="db-tables">
        <PanelHead id="lwDbTables" title="Tables" sub="Live from the database. Row counts are the database’s own estimates, so large tables can be slightly off.">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>{loading ? <><span className="lw-spin" aria-hidden="true" />Checking…</> : 'Check again'}</button>
        </PanelHead>
        <Chips label="Order" value={sort} onChange={setSort} options={[['size', 'Biggest first'], ['rows', 'Most rows first'], ['name', 'A to Z']]} />
        <LoadError error={error} what="the table list" onRetry={reload} />
        {loading && !data ? <Loading>Asking the database…</Loading> : null}
        {data ? <CardTable caption="Tables" rows={tables} rowKey={t => t.name} rowProps={t => ({ 'data-table': t.name })} empty="The server reported no tables." cols={[
          ['Table', t => <span className="lw-mono">{t.name}</span>],
          ['What it holds', t => <span className="lw-small" style={{ color: 'var(--foreground)' }}>{TABLE_HELP[t.name] || 'Not described'}</span>],
          ['Rows', t => (t.estimated ? 'About ' : '') + count(t.rows)],
          ['Size', t => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i aria-hidden="true" style={{ display: 'inline-block', height: 6, borderRadius: 3, background: 'var(--chart-2)', width: Math.max(2, Math.round(60 * (t.bytes || 0) / top)) }} />{bytes(t.bytes)}</span>],
        ]} /> : null}
      </section>
      <div className="grid-2">
        <section className="panel" aria-labelledby="lwDbAbout">
          <PanelHead id="lwDbAbout" title="The database" />
          <KV rows={[
            ['Postgres version', db.serverVersion ? String(db.serverVersion).split(' ')[0] : ''],
            ['Server time zone', db.timeZone || ''],
            ['Server time', db.time ? when(db.time) : ''],
            ['Answered in', db.latencyMs != null ? ms(db.latencyMs) : ''],
          ]} />
        </section>
        <section className="panel" aria-labelledby="lwDbMore">
          <PanelHead id="lwDbMore" title="More in Supabase" />
          <Note tone="info">
            <p>Browse rows in <Where>Supabase dashboard → Table Editor</Where>, run queries in <Where>SQL Editor</Where>, and see daily backups under <Where>Database → Backups</Where>.</p>
            <p>How much of the plan’s database space is used is under <Where>Usage</Where> in the Supabase dashboard.</p>
          </Note>
        </section>
      </div>
    </>
  );
}
