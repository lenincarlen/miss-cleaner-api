import { Router } from 'express'

import { login, refresh, me } from '../../controllers/auth/authController'

const router = Router()

router.post('/login', login)
router.post('/refresh', refresh)
router.get('/me', me)

export default router


