import Icon from './Icon.jsx';
import { Sparkline } from './Charts.jsx';

/* a KPI card: label + icon, the big number, a small line under it, and (when given) a small
   trend line of the last days */
export default function MetricCard({ label, value, sub, icon = 'activity', trend, trendColor }) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span>{label}</span><Icon id={icon} size={16} /></div>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
      {trend ? <Sparkline values={trend} color={trendColor} label={label} /> : null}
    </div>
  );
}
