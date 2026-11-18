import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { contentRouter } from './content.routes.js';
import { venuesRouter } from './venues.routes.js';
import { operationsRouter } from './operations.routes.js';
import { reportsRouter } from './reports.routes.js';

/** NFR-9: role-based access to every admin endpoint. */
export const adminRouter = Router();
adminRouter.use(requireRole('CINEMA_ADMIN', 'SUPER_ADMIN'));
adminRouter.use(contentRouter);
adminRouter.use(venuesRouter);
adminRouter.use(operationsRouter);
adminRouter.use(reportsRouter);
