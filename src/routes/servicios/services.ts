import { Router } from 'express'
import {
  getServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
  getServiceMetadata,
  serviceBannerUpload,
} from '../../controllers/servicios/servicesController'

const router = Router()

router.get('/', getServices)
router.get('/metadata', getServiceMetadata)
router.get('/:id', getServiceById)
// Accept multipart form-data: fields + optional banner file under field name "banner"
router.post('/', serviceBannerUpload.single('banner'), createService)
router.put('/:id', serviceBannerUpload.single('banner'), updateService)
router.patch('/:id', serviceBannerUpload.single('banner'), updateService)
router.delete('/:id', deleteService)

export default router
