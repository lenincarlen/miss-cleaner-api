import { Router } from 'express'
import {
  getReports,
  getReportById,
  createReport,
  updateReport,
  deleteReport,
  downloadReportInvoice,
} from '../../controllers/reports/reportsController'

const router = Router()

router.get('/', getReports)
router.get('/:id', getReportById)
router.get('/:id/invoice', downloadReportInvoice)
router.post('/', createReport)
router.put('/:id', updateReport)
router.delete('/:id', deleteReport)

export default router
