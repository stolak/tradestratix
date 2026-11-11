import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateStrict } from '../middlewares/auth.js';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     security: []
 *     summary: Login with username and password
 */
router.post('/login', authController.login);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 */
router.get('/me', authenticateStrict, authController.me);

/**
 * @openapi
 * /api/v1/auth/switch-branch:
 *   post:
 *     tags: [Auth]
 *     summary: Switch active branch and receive a new token
 */
router.post('/switch-branch', authenticateStrict, authController.switchBranch);

export default router;
