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

export default router;
