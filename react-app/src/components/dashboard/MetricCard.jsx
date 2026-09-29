import Icon from './Icon.jsx';

/* a KPI card: label + icon, the big number, a small line under it */
export default function MetricCard({ label, value, sub, icon = 'activity' }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span>{label}</span><Icon id={icon} size={16} /></div>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}
