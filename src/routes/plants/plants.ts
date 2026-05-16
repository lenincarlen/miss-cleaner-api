import { Router } from 'express'
import { createPlant, createPlantOperator, getPlantById, getPlants, updatePlant } from '../../controllers/plants/plantsController'

const router = Router()

router.get('/', getPlants)
router.post('/', createPlant)
router.post('/:plant_id/operators', createPlantOperator) // Debe ir antes de /:id
router.get('/:id', getPlantById)
router.put('/:id', updatePlant)

export default router


