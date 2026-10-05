/* the Admin panel: one page component per sidebar section */
import Overview from './Overview.jsx';
import Products from './Products.jsx';
import Orders from './Orders.jsx';
import Customers from './Customers.jsx';
import Messages from './Messages.jsx';
import Analytics from './Analytics.jsx';
import Coupons from './Coupons.jsx';
import Content from './Content.jsx';
import Roles from './Roles.jsx';
import Settings from './Settings.jsx';
import AuditLogs from './AuditLogs.jsx';

export const ADMIN = { overview: Overview, products: Products, orders: Orders, customers: Customers, messages: Messages, analytics: Analytics, coupons: Coupons, content: Content, roles: Roles, settings: Settings, audit: AuditLogs };
