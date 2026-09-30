/* the Developer panel: one page component per sidebar section */
import Health from './Health.jsx';
import Errors from './Errors.jsx';
import ApiMonitor from './ApiMonitor.jsx';
import Database from './Database.jsx';
import Performance from './Performance.jsx';
import Deployments from './Deployments.jsx';
import Backups from './Backups.jsx';
import { Payments, Webhooks, Auth, Security } from './Logs.jsx';
import AuditLogs from '../Admin/AuditLogs.jsx';

export const DEV = { health: Health, errors: Errors, api: ApiMonitor, db: Database, payments: Payments, webhooks: Webhooks, auth: Auth, perf: Performance, security: Security, deploy: Deployments, backups: Backups, audit: AuditLogs };
