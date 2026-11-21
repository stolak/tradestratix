import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateStrict } from '../middlewares/auth.js';
import { loginRateLimiter } from '../middlewares/login-rate-limit.js';
import { isDemoLoginEnabled } from '../utils/demo-login.js';

const router = Router();

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     security: []
 *     summary: Login with username and password
 */
router.post('/login', loginRateLimiter, authController.login);

/**
 * @openapi
 * /api/v1/auth/mfa/verify:
 *   post:
 *     tags: [Auth]
 *     security: []
 *     summary: Complete login with MFA code
 */
router.post('/mfa/verify', loginRateLimiter, authController.verifyMfa);

/**
 * @openapi
 * /api/v1/auth/demo-users:
 *   get:
 *     tags: [Auth]
 *     security: []
 *     summary: List seeded demo accounts for one-click login (non-production unless ENABLE_DEMO_LOGIN=true)
 */
router.get('/demo-users', (req, res, next) => {
  if (!isDemoLoginEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return authController.demoUsers(req, res, next);
});

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
