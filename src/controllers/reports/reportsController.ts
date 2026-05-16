import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import path from 'node:path'
import { prisma } from '../../lib/prisma'

const parseDecimal = (value?: number | string | null) => {
  if (value === undefined) return undefined
  if (value === null) return null
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '' || normalized === null || normalized === undefined) return null
  return new Prisma.Decimal(normalized as any)
}

const parseDate = (value?: string | null) => {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

const reportDetailInclude = Prisma.validator<Prisma.ReportInclude>()({
  institution: {
    select: {
      id: true,
      name: true,
      rnc: true,
      contact_email: true,
      phone: true,
      address: true,
    },
  },
  invoice_file: {
    select: {
      id: true,
      original_name: true,
      storage_path: true,
      mime_type: true,
      file_size: true,
      created_at: true,
    },
  },
  generated_by_user: {
    select: {
      id: true,
      email: true,
      profiles: {
        take: 1,
        select: {
          id: true,
          full_name: true,
        },
      },
    },
  },
  payments: {
    include: {
      currency: {
        select: {
          id: true,
          iso_code: true,
          symbol: true,
          name: true,
        },
      },
      institution: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      payment_date: 'desc',
    },
  },
})

type ReportWithRelations = Prisma.ReportGetPayload<{ include: typeof reportDetailInclude }>

type ReportCreateInput = {
  institution_id: string
  reporting_period: string
  total_billed?: number | string | null
  payment_status?: string | null
  invoice_file_id?: string | null
  due_date?: string | null
  generated_by_user_id?: string | null
}

type ReportUpdateInput = Partial<ReportCreateInput>

const getPeriodRange = (period?: string | null) => {
  if (!period) return null
  const [yearStr, monthStr] = period.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)

  if (!year || !month || Number.isNaN(year) || Number.isNaN(month)) {
    return null
  }

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  return { start, end }
}

const toNumber = (value?: Prisma.Decimal | number | string | bigint | null) => {
  if (value === null || value === undefined) return null
  if (value instanceof Prisma.Decimal) {
    return value.toNumber()
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

// Get all reports
export const getReports = async (_req: Request, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      include: {
        institution: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice_file: {
          select: {
            id: true,
            original_name: true,
            storage_path: true,
          },
        },
        generated_by_user: {
          select: {
            id: true,
            email: true,
            profiles: {
              take: 1,
              select: {
                id: true,
                full_name: true,
              },
            },
          },
        },
        payments: {
          include: {
            currency: {
              select: {
                iso_code: true,
                symbol: true,
              },
            },
          },
          orderBy: {
            payment_date: 'desc',
          },
        },
      },
      orderBy: {
        generated_at: 'desc',
      },
    })

    res.json(reports)
  } catch (err) {
    console.error('Error fetching reports:', err)
    res.status(500).json({ message: 'Error fetching reports' })
  }
}

// Get report by ID
export const getReportById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const report = await prisma.report.findUnique({
      where: { id },
      include: reportDetailInclude,
    })

    if (!report) {
      return res.status(404).json({ message: 'Report not found' })
    }

    const periodRange = getPeriodRange(report.reporting_period)

    const [incomes, expenses] = periodRange
      ? await Promise.all([
          prisma.ingreso.findMany({
            where: {
              institution_id: report.institution_id,
              income_date: {
                gte: periodRange.start,
                lte: periodRange.end,
              },
            },
            orderBy: {
              income_date: 'desc',
            },
          }),
          prisma.gasto.findMany({
            where: {
              institution_id: report.institution_id,
              expense_date: {
                gte: periodRange.start,
                lte: periodRange.end,
              },
            },
            orderBy: {
              expense_date: 'desc',
            },
          }),
        ])
      : [[], []]

    const totalIncomes = incomes.reduce((sum: number, ingreso: any) => {
      const value = toNumber(ingreso.amount)
      return value !== null ? sum + value : sum
    }, 0)

    const totalExpenses = expenses.reduce((sum: number, gasto: any) => {
      const value = toNumber(gasto.amount)
      return value !== null ? sum + value : sum
    }, 0)

    const reportWithRelations = report as ReportWithRelations
    const totalPayments = reportWithRelations.payments.reduce((sum: number, payment: any) => {
      const value = toNumber(payment.amount)
      return value !== null ? sum + value : sum
    }, 0)

    const totalBilled = toNumber(report.total_billed) ?? 0
    const outstandingBalance = Math.max(totalBilled - totalPayments, 0)
    const periodBalance = totalIncomes - totalExpenses

    const orders = periodRange
      ? await prisma.order.findMany({
          where: {
            institution_id: report.institution_id,
            created_at: {
              gte: periodRange.start,
              lte: periodRange.end,
            },
          },
          include: {
            profile: {
              select: {
                id: true,
                full_name: true,
              },
            },
            order_items: {
              select: {
                id: true,
                description: true,
                quantity: true,
                total_price: true,
                service: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            created_at: 'asc',
          },
        })
      : []

    const totalOrdersAmount = orders.reduce((sum: number, order: any) => {
      const value = toNumber(order.total_amount)
      return value !== null ? sum + value : sum
    }, 0)

    res.json({
      ...report,
      incomes,
      expenses,
      orders,
      summary: {
        total_incomes: totalIncomes,
        total_expenses: totalExpenses,
        total_payments: totalPayments,
        balance: periodBalance,
        outstanding_balance: outstandingBalance,
        total_orders: totalOrdersAmount,
      },
    })
  } catch (err) {
    console.error(`Error fetching report with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching report' })
  }
}

export const downloadReportInvoice = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        invoice_file: true,
      },
    })

    if (!report) {
      return res.status(404).json({ message: 'Report not found' })
    }

    if (!report.invoice_file) {
      return res.status(404).json({ message: 'Invoice file not available for this report' })
    }

    const { storage_path, mime_type, original_name } = report.invoice_file

    if (!storage_path) {
      return res.status(404).json({ message: 'Invoice file path missing' })
    }

    const absolutePath = path.isAbsolute(storage_path)
      ? storage_path
      : path.join(process.cwd(), storage_path)

    res.setHeader('Content-Type', mime_type ?? 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(original_name ?? 'factura.pdf')}"`
    )

    return res.sendFile(absolutePath, (err) => {
      if (err) {
        console.error('Error sending invoice file:', err)
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading invoice file' })
        }
      }
    })
  } catch (err) {
    console.error(`Error downloading invoice for report ${id}:`, err)
    res.status(500).json({ message: 'Error downloading invoice file' })
  }
}

// Create a new report
export const createReport = async (req: Request, res: Response) => {
  const {
    institution_id,
    reporting_period,
    total_billed,
    payment_status,
    invoice_file_id,
    due_date,
    generated_by_user_id,
  }: ReportCreateInput = req.body

  console.log('Creating report with data:', {
    institution_id,
    reporting_period,
    total_billed,
    payment_status,
    generated_by_user_id,
  })

  try {
    const report = await prisma.report.create({
      data: {
        institution_id,
        reporting_period,
        total_billed: parseDecimal(total_billed) ?? undefined,
        payment_status: payment_status ?? undefined,
        invoice_file_id: invoice_file_id ?? undefined,
        due_date: parseDate(due_date),
        generated_by_user_id: generated_by_user_id ?? undefined,
      },
      include: reportDetailInclude,
    })

    console.log('Report created successfully:', report.id, 'generated by:', report.generated_by_user_id)

    res.status(201).json(report)
  } catch (err: any) {
    console.error('Error creating report:', err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Institution not found' })
    }
    res.status(500).json({ message: 'Error creating report' })
  }
}

// Update a report
export const updateReport = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: ReportUpdateInput = req.body

  try {
    const report = await prisma.report.update({
      where: { id },
      data: {
        total_billed: parseDecimal(data.total_billed) ?? undefined,
        payment_status: data.payment_status ?? undefined,
        invoice_file_id: data.invoice_file_id ?? undefined,
        due_date: parseDate(data.due_date),
        reporting_period: data.reporting_period ?? undefined,
        institution_id: data.institution_id ?? undefined,
        generated_by_user_id: data.generated_by_user_id ?? undefined,
      },
      include: reportDetailInclude,
    })

    res.json(report)
  } catch (err: any) {
    console.error(`Error updating report with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Report not found' })
    }
    res.status(500).json({ message: 'Error updating report' })
  }
}

// Delete a report
export const deleteReport = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.report.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting report with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Report not found' })
    }
    res.status(500).json({ message: 'Error deleting report' })
  }
}
