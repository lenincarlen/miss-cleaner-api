import { Router } from 'express'
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
  confirmPickupFromInstitution,
  confirmPlantReceived,
  confirmPlantReadyPickup,
  confirmFinalDelivery,
  getConfirmationCode,
} from '../../controllers/orders/ordersController'
import { requirePermissionOrRoles } from '../../middleware/authz'

const router = Router()

router.get('/', getOrders)
router.get('/:id/confirmation-code', getConfirmationCode) // Debe ir antes de /:id
router.get('/:id', getOrderById)
router.post('/', createOrder)
// Permitir a roles administradores y permiso específico de logística "orders_delivery"
router.put(
  '/:id',
  requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']),
  updateOrder
)
router.delete('/:id', deleteOrder)

// Endpoints de confirmación con códigos
router.post('/:order_id/confirm-pickup', confirmPickupFromInstitution)
router.post('/:order_id/confirm-plant-received', confirmPlantReceived)
router.post('/:order_id/confirm-plant-ready-pickup', confirmPlantReadyPickup)
router.post('/:order_id/confirm-final-delivery', confirmFinalDelivery)

export default router
