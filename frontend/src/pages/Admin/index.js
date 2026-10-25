/* the Admin panel: one page component per sidebar section */
import Overview from './Overview.jsx';
import Products from './Products.jsx';
import Categories from './Categories.jsx';
import Homepage from './Homepage.jsx';
import Orders from './Orders.jsx';
import Customers from './Customers.jsx';
import Security from './Security.jsx';
import Messages from './Messages.jsx';
import Analytics from './Analytics.jsx';
import Coupons from './Coupons.jsx';
import Content from './Content.jsx';
import Settings from './Settings.jsx';
import AuditLogs from './AuditLogs.jsx';

export const ADMIN = { overview: Overview, products: Products, categories: Categories, homepage: Homepage, orders: Orders, customers: Customers, security: Security, messages: Messages, analytics: Analytics, coupons: Coupons, content: Content, settings: Settings, audit: AuditLogs };
