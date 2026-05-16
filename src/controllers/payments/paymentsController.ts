import { Request, Response } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../../lib/prisma'
import { normalizeBigInts } from '../../utils/serialization'

const receiptsDir = path.join(process.cwd(), 'uploads', 'receipts')

const ensureReceiptsDir = async () => {
  try {
    await fs.mkdir(receiptsDir, { recursive: true })
  } catch (err) {
    console.error('Failed to ensure receipts directory', err)
  }
}

ensureReceiptsDir()

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, receiptsDir)
  },
  filename(_req, file, cb) {
    const sanitized = file.originalname.replace(/\s+/g, '_')
    cb(null, `${Date.now()}-${sanitized}`)
  },
})

export const receiptUpload = multer({ storage })

const buildReceiptFile = async (file?: Express.Multer.File | null) => {
  if (!file) return undefined

  const relativePath = path.relative(process.cwd(), file.path)

  const created = await prisma.file.create({
    data: {
      storage_path: relativePath,
      original_name: file.originalname,
      mime_type: file.mimetype,
      file_size: BigInt(file.size),
      checksum: null,
    },
  })

  return created.id
}

const recalcReportPaymentStatus = async (reportId?: string | null) => {
  if (!reportId) return
  try {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, total_billed: true },
    })
    if (!report) return

    const payments = await prisma.payment.findMany({
      where: { report_id: reportId, status: 'paid' },
      select: { amount: true },
    })

    const paidTotal = payments.reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0)
    const totalBilled = Number((report as any).total_billed ?? 0)

    let newStatus: string | null = null
    if (paidTotal <= 0) newStatus = 'pending'
    else if (paidTotal > 0 && paidTotal < totalBilled) newStatus = 'partially_paid'
    else if (paidTotal >= totalBilled && totalBilled > 0) newStatus = 'paid'

    await prisma.report.update({
      where: { id: reportId },
      data: { payment_status: newStatus ?? undefined },
    })
  } catch (err) {
    console.error('Failed to recalc report payment status', { reportId, err })
  }
}

type PaymentCreatePayload = {
  report_id?: string | null
  institution_id: string
  amount: number | string
  payment_method?: string | null
  reference_code?: string | null
  notes?: string | null
  status?: string | null
}

type PaymentUpdatePayload = Partial<PaymentCreatePayload> & {
  receipt_file_action?: 'replace' | 'remove'
}

type PaymentQuery = {
  institution_id?: string
  date_from?: string
  date_to?: string
  method?: string
  status?: string
}

const paymentInclude = {
  report: {
    select: {
      id: true,
      reporting_period: true,
      total_billed: true,
    },
  },
  institution: {
    select: {
      id: true,
      name: true,
    },
  },
  receipt_file: {
    select: {
      id: true,
      original_name: true,
      storage_path: true,
      mime_type: true,
      file_size: true,
      created_at: true,
    },
  },
} as const

const buildWhereFromQuery = (query: PaymentQuery) => {
  const where: any = {}

  if (query.institution_id) {
    where.institution_id = query.institution_id
  }

  if (query.date_from || query.date_to) {
    where.payment_date = {
      gte: query.date_from ? new Date(query.date_from) : undefined,
      lte: query.date_to ? new Date(query.date_to) : undefined,
    }
  }

  if (query.method && query.method !== 'all') {
    where.payment_method = query.method
  }

  if (query.status && query.status !== 'all') {
    where.status = query.status
  }

  return where
}

export const getPayments = async (req: Request, res: Response) => {
  const query = req.query as PaymentQuery

  try {
    const payments = await prisma.payment.findMany({
      where: buildWhereFromQuery(query),
      include: paymentInclude,
      orderBy: {
        payment_date: 'desc',
      },
    })

    res.json(normalizeBigInts(payments))
  } catch (err) {
    console.error('Error fetching payments:', err)
    res.status(500).json({ message: 'Error fetching payments' })
  }
}

export const getPaymentById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: paymentInclude,
    })

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' })
    }

    res.json(normalizeBigInts(payment))
  } catch (err) {
    console.error(`Error fetching payment with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching payment' })
  }
}

export const createPayment = async (req: Request, res: Response) => {
  const {
    report_id,
    institution_id,
    amount,
    payment_method,
    reference_code,
    notes,
    status,
  } = req.body as PaymentCreatePayload

  try {
    const receipt_file_id = await buildReceiptFile((req as any).file)

    const payment = await prisma.payment.create({
      data: {
        report_id,
        institution_id,
        amount: Number(amount),
        payment_method,
        reference_code,
        notes,
      status: status ?? undefined,
      receipt_file_id: receipt_file_id ?? undefined,
      },
      include: paymentInclude,
    })

    // If no report_id provided, try to auto-link to the institution's report for the payment month
    let finalReportId = report_id ?? null
    if (!finalReportId && payment.institution?.id) {
      try {
        const paymentRecord = await prisma.payment.findUnique({ where: { id: (payment as any).id }, select: { payment_date: true } })
        const payDate = paymentRecord?.payment_date ? new Date(paymentRecord.payment_date as any) : new Date()
        const y = payDate.getUTCFullYear()
        const m = String(payDate.getUTCMonth() + 1).padStart(2, '0')
        const period = `${y}-${m}`

        const candidate = await prisma.report.findFirst({
          where: {
            institution_id,
            reporting_period: period,
          },
          orderBy: { generated_at: 'desc' },
          select: { id: true },
        })

        if (candidate?.id) {
          await prisma.payment.update({ where: { id: (payment as any).id }, data: { report_id: candidate.id } })
          finalReportId = candidate.id
        }
      } catch (err) {
        console.warn('Auto-link payment to report failed', { paymentId: (payment as any).id, err })
      }
    }

    // Recalculate report payment status if linked (original or auto-linked)
    await recalcReportPaymentStatus(finalReportId ?? undefined)

    res.status(201).json(normalizeBigInts(payment))
  } catch (err: any) {
    console.error('Error creating payment:', err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Related entity not found' })
    }
    res.status(500).json({ message: 'Error creating payment' })
  }
}

export const updatePayment = async (req: Request, res: Response) => {
  const { id } = req.params
  const data = req.body as PaymentUpdatePayload

  try {
    const existing = await prisma.payment.findUnique({
      where: { id },
      include: { receipt_file: true },
    })

    if (!existing) {
      return res.status(404).json({ message: 'Payment not found' })
    }

    let receiptFileId: string | null | undefined = existing.receipt_file?.id ?? null

    if ((req as any).file) {
      receiptFileId = await buildReceiptFile((req as any).file)
    } else if (data.receipt_file_action === 'remove') {
      receiptFileId = null
    }

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        amount: data.amount !== undefined ? Number(data.amount) : undefined,
        payment_method: data.payment_method ?? undefined,
        reference_code: data.reference_code ?? undefined,
        report_id: data.report_id ?? undefined,
        notes: data.notes ?? undefined,
        status: data.status ?? undefined,
        receipt_file_id: receiptFileId === undefined ? undefined : receiptFileId,
      },
      include: paymentInclude,
    })

    // Recalculate old and new report statuses if report link changed or status/amount changed
    if (existing.report_id && existing.report_id !== updated.report_id) {
      await recalcReportPaymentStatus(existing.report_id)
    }
    await recalcReportPaymentStatus(updated.report_id)

    res.json(normalizeBigInts(updated))
  } catch (err: any) {
    console.error(`Error updating payment with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Payment not found' })
    }
    res.status(500).json({ message: 'Error updating payment' })
  }
}

export const deletePayment = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.payment.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting payment with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Payment not found' })
    }
    res.status(500).json({ message: 'Error deleting payment' })
  }
}
