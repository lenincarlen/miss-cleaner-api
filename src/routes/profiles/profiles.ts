import { Router } from 'express'
import {
  getProfiles,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
} from '../../controllers/profiles/profilesController'

const router = Router()

router.get('/', getProfiles)
router.get('/:id', getProfileById)
router.post('/', createProfile)
router.put('/:id', updateProfile)
router.delete('/:id', deleteProfile)

export default router
