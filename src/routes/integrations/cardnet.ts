import { Router } from 'express'
import { processPayment, directTokenize } from '../../controllers/integrations/cardnetController'

const router = Router()

router.post('/purchase', processPayment)
router.post('/tokenize-direct', directTokenize)

export default router
