import { Router } from 'express'
import {
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  deletePayment,
} from '../../controllers/payments/paymentsController'
import { receiptUpload } from '../../controllers/payments/paymentsController'

const router = Router()

router.get('/', getPayments)
router.get('/:id', getPaymentById)
router.post('/', receiptUpload.single('receipt'), createPayment)
router.put('/:id', receiptUpload.single('receipt'), updatePayment)
router.delete('/:id', deletePayment)

export default router
