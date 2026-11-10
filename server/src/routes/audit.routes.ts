import { Router } from 'express';
import * as auditController from '../controllers/audit.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);
router.get('/', requirePermission('audit.view'), auditController.list);

export default router;
