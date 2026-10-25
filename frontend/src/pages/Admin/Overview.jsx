import MetricCard from '../../components/dashboard/MetricCard.jsx';
import DataTable from '../../components/dashboard/DataTable.jsx';
import Pill from '../../components/dashboard/Pill.jsx';
import Icon from '../../components/dashboard/Icon.jsx';
import { BarChart, Donut, SplitBar, Meter } from '../../components/dashboard/Charts.jsx';
import { Guard, ErrorNote } from '../../components/dashboard/States.jsx';
import { useDash } from '../Portal/DashContext.js';
import { useStaffGet, inr, cur, fmt, initialsOf, tzName, qs, plural } from '../Portal/dashboard.js';
import { ORDER_STATUS_LABEL, orderWhat } from './common.js';

/* Dashboard: revenue, sales, open access and visitors today (GET /api/admin/stats), the sales
   chart, the latest paid orders and what needs a look. */
export default function Overview() {
  const { go, can, allowed } = useDash();
  const st = useStaffGet('/api/admin/stats' + qs({ tz: tzName() }));
  const latest = useStaffGet(can('orders.read') ? '/api/admin/orders?limit=8' : null);
  const s = st.data;
  const orders = (latest.data && latest.data.orders) || [];
  const paid = orders.filter(o => o.status === 'paid').slice(0, 5);
  const days = s ? s.revenueByDay || [] : [];

  /* things staff may want to look at, each one opens its section */
  const todo = s ? [
    ['messages', 'messages', s.messages_unread, n => plural(n, 'unread message')],
    ['security', 'security', (s.openIncidents || 0), n => plural(n, 'possible sharing case') + ' to review'],
    ['security', 'security', (s.openAppeals || 0), n => plural(n, 'customer note') + ' about a warning or block'],
    ['content', 'star', s.pendingReviews, n => plural(n, 'review') + ' waiting to be published'],
    ['products', 'file', Math.max(0, (s.worksheets || 0) - (s.with_pdf || 0)), n => plural(n, 'sheet') + ' without a PDF'],
    ['developer', 'mail', s.emailsFailed, n => plural(n, 'email') + ' could not be sent'],
  ].filter(([, , n]) => n > 0) : [];
  const testMode = s && s.gateways ? Object.entries(s.gateways).filter(([, m]) => m && m !== 'live').map(([g]) => g) : [];

  return (
    <Guard state={st} rows={6}>
      {allowed('analytics') || allowed('money') ? <div className="tabs-s"><button type="button" className="on">Overview</button>{allowed('analytics') ? <button type="button" onClick={() => go('analytics')}>Analytics</button> : null}{allowed('money') ? <button type="button" onClick={() => go('money')}>Money</button> : null}</div> : null}
      {st.error ? <ErrorNote error={st.error} onRetry={st.reload} compact /> : null}
      {s ? <>
        <div className="kpi-row">
          <MetricCard label="Total revenue" value={inr(s.revenue_inr)} sub={(s.today && s.today.revenueInr ? '+' + inr(s.today.revenueInr) : 'Nothing yet') + ' today' + (s.refundedInr ? ' · ' + inr(s.refundedInr) + ' refunded' : '')} icon="rupee" trend={days.map(d => d.revenueInr || 0)} />
          <MetricCard label="Paid orders" value={s.paid_orders} sub={plural(s.today ? s.today.paidOrders : 0, 'payment') + ' today · ' + (s.pendingOrders || 0) + ' waiting for payment'} icon="card" trend={days.map(d => d.paidOrders || 0)} trendColor="var(--viz-3)" />
          <MetricCard label="Open access" value={s.active_entitlements} sub={plural(s.activePlans || 0, 'class plan') + ' among them'} icon="users" />
          <MetricCard label="Visitors today" value={s.today ? s.today.visitors : 0} sub={'+' + (s.today ? s.today.visitorsLastHour : 0) + ' in the last hour · ' + plural(s.users || 0, 'customer') + ' in all'} icon="activity" />
        </div>
        <div className="grid-7">
          <section className="panel span-4"><p className="eyebrow">Sales</p><p className="auth-sub">Paid orders in rupees, per day, last {days.length} days.</p><BarChart series={days.map(d => d.revenueInr || 0)} labels={days.map(d => d.day)} prefix="₹" color="var(--viz-1)" empty="No sales in the last 14 days yet." /></section>
          <section className="panel span-3"><p className="eyebrow">Recent sales</p>
            {!can('orders.read') ? <p className="auth-sub">Your role does not show orders.</p>
              : latest.error ? <ErrorNote error={latest.error} onRetry={latest.reload} compact />
                : <><p className="auth-sub">{plural(s.paid_orders, 'paid order')} in total.</p>
                  {paid.length ? <div className="sales">{paid.map(o => (
                    <div key={o.id} className="sale"><span className="av round">{initialsOf(o.name || o.email)}</span>
                      <div className="who"><div><p className="nm">{o.name || o.email.split('@')[0]}</p><p className="em">{o.email}</p></div><span className="amt" title={o.currency !== 'INR' ? 'Paid ' + cur(o.total, o.currency) : undefined}>+{inr(o.totalInr)}</span></div></div>
                  ))}</div> : <p className="cart-empty">{latest.loading ? 'Loading…' : 'No paid orders yet. They appear here when a customer pays.'}</p>}</>}
          </section>
        </div>
        <div className="grid-2">
          <section className="panel"><p className="eyebrow">Needs a look</p>
            {todo.length || testMode.length || s.mail === 'none' ? <ul className="todo">
              {todo.map(([sec, icon, n, text], i) => <li key={i}><Icon id={icon} />{sec !== 'developer' && allowed(sec) ? <button type="button" className="link" onClick={() => go(sec)}>{text(n)}</button> : <span>{text(n)}</span>}</li>)}
              {testMode.length ? <li><Icon id="card" /><span>Payments are in test mode ({testMode.join(', ')}): no real money is taken.</span></li> : null}
              {s.mail === 'none' ? <li><Icon id="mail" /><span>Email is not set up, so no emails are sent.</span></li> : null}
            </ul> : <p className="cart-empty">Nothing is waiting. All caught up.</p>}
          </section>
          <section className="panel"><p className="eyebrow">The shop</p>
            <div className="kv">
              <span>Sheets on sale</span><b>{s.worksheets}</b>
              <span>Opened in the last 24 hours</span><b>{s.opens_24h}</b>
              <span>Sign-ups today</span><b>{s.today ? s.today.signups : 0}</b>
              <span>Staff members</span><b>{s.staff}</b>
            </div>
            <div className="meters" style={{ marginTop: 16 }}>
              <Meter label="Sheets on sale with their PDF" value={s.with_pdf} max={s.worksheets} />
              <Meter label="Messages read" value={(s.messages || 0) - (s.messages_unread || 0)} max={s.messages} />
            </div>
          </section>
        </div>
        <div className="grid-2">
          <section className="panel"><p className="eyebrow">Customers</p><p className="auth-sub">Every customer account, and how many are paused or blocked.</p>
            <Donut parts={[['Active', Math.max(0, (s.users || 0) - (s.suspendedCustomers || 0) - (s.blockedCustomers || 0)), 'var(--viz-1)'], ['Paid access paused', s.suspendedCustomers, 'var(--viz-4)'], ['Blocked', s.blockedCustomers, 'var(--viz-2)']]} sub="customers" empty="No customers yet. They appear here when someone signs up." />
          </section>
          <section className="panel"><p className="eyebrow">Orders</p><p className="auth-sub">All orders so far, by what happened to them.</p>
            <SplitBar parts={[['Paid', s.paid_orders, 'var(--viz-1)'], ['Waiting for payment', s.pendingOrders, 'var(--viz-4)'], ['Refunded', s.refundedOrders, 'var(--viz-2)']]} empty="No orders yet. They appear here when a customer checks out." />
            <div className="meters" style={{ marginTop: 20 }}>
              <Meter label="Open access that is a class plan" value={s.activePlans} max={s.active_entitlements} tone={s.active_entitlements ? 'ok' : 'none'} />
            </div>
          </section>
        </div>
      </> : null}
      {can('orders.read') ? <section className="panel"><p className="eyebrow">Latest orders</p><p className="auth-sub">The newest orders of any status. Open one to see its details.</p>
        {latest.error ? <ErrorNote error={latest.error} onRetry={latest.reload} compact />
          : <DataTable head={['Order', 'Customer', 'What', 'Amount', 'Status', 'When']} plain empty={latest.loading ? 'Loading…' : 'No orders yet.'}
            rows={orders.slice(0, 6).map(o => ({ key: o.id, onClick: () => go('orders', { order: o.id }), cells: [<button key="i" type="button" className="link mono" onClick={() => go('orders', { order: o.id })}>{o.id}</button>, o.email, orderWhat(o), inr(o.totalInr), <Pill key="s" tone={o.status}>{ORDER_STATUS_LABEL[o.status] || o.status}</Pill>, fmt(o.at)] }))} />}
      </section> : null}
    </Guard>
  );
}
