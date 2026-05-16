import { Router } from 'express'
import { createZone, getZoneById, getZones, updateZone } from '../../controllers/zones/zonesController'

const router = Router()

router.get('/', getZones)
router.get('/:id', getZoneById)
router.post('/', createZone)
router.put('/:id', updateZone)

export default router


