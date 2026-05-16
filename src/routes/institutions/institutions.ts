import { Router } from 'express'
import {
  getInstitutions,
  getInstitutionById,
  createInstitution,
  updateInstitution,
  deleteInstitution,
  getOrganizationTypes,
} from '../../controllers/institutions/institutionsController'

const router = Router()

router.get('/', getInstitutions)
router.get('/meta/types', getOrganizationTypes)
router.get('/:id', getInstitutionById)
router.post('/', createInstitution)
router.put('/:id', updateInstitution)
router.delete('/:id', deleteInstitution)

export default router
