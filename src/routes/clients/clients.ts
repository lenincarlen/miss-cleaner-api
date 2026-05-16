import { Router } from 'express'
import {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getClientsByInstitution,
  updateClientCredit,
  createClientForInstitution,
  getCurrentClientAccount,
  changeCurrentClientPassword,
  getCurrentClientPaymentMethods,
  createCurrentClientPaymentMethod,
  deleteCurrentClientPaymentMethod,
} from '../../controllers/clients/clientsController'

const router = Router()

// Basic CRUD operations
router.get('/me/account', getCurrentClientAccount)
router.patch('/me/password', changeCurrentClientPassword)
router.get('/me/payment-methods', getCurrentClientPaymentMethods)
router.post('/me/payment-methods', createCurrentClientPaymentMethod)
router.delete('/me/payment-methods/:paymentMethodId', deleteCurrentClientPaymentMethod)

router.get('/', getClients)
router.get('/institution/:institutionId', getClientsByInstitution)
router.get('/:id', getClientById)
router.post('/', createClient)
router.post('/institution/:institutionId', createClientForInstitution)
router.put('/:id', updateClient)
router.delete('/:id', deleteClient)

// Additional endpoints
router.patch('/:id/credit', updateClientCredit)

export default router
