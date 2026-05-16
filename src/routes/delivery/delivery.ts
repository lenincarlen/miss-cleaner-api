import { Router } from 'express'
import {
  getDeliveries,
  getDeliveryById,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  assignDelivery,
  acceptDelivery,
  completeDelivery,
  rejectDelivery,
} from '../../controllers/delivery/deliveryController'
import { requirePermissionOrRoles } from '../../middleware/authz'

const router = Router()

router.get('/', getDeliveries)
router.get('/:id', getDeliveryById)
// Protección básica: acciones sensibles requieren permiso de logística o roles admin
router.post('/', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), createDelivery)
router.put('/:id', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), updateDelivery)
router.delete('/:id', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), deleteDelivery)
router.post('/:id/assign', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), assignDelivery)
router.post('/:id/accept', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), acceptDelivery)
router.post('/:id/complete', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), completeDelivery)
router.post('/:id/reject', requirePermissionOrRoles('orders_delivery', ['admin', 'administrator', 'system_admin', 'super_admin']), rejectDelivery)

export default router
