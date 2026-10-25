// Registers every route module on the shared router.
import { router } from '../lib/app.ts';
import { register as publicRoutes } from './public.ts';
import { register as authRoutes } from './auth.ts';
import { register as accountRoutes } from './account.ts';
import { register as shopRoutes } from './shop.ts';
import { register as paymentRoutes } from './payments.ts';
import { register as cartRoutes } from './cart.ts';
import { register as accessRoutes } from './access.ts';
import { register as adminCatalogue } from './admin_catalogue.ts';
import { register as adminCommerce } from './admin_commerce.ts';
import { register as adminPeople } from './admin_people.ts';
import { register as adminSecurity } from './admin_security.ts';
import { register as adminOps } from './admin_ops.ts';
import { register as adminStore } from './admin_store.ts';
import { register as adminFinance } from './admin_finance.ts';

for (const r of [publicRoutes, authRoutes, accountRoutes, shopRoutes, cartRoutes, paymentRoutes, accessRoutes,
  adminCatalogue, adminCommerce, adminPeople, adminSecurity, adminOps, adminStore, adminFinance]) r(router);
