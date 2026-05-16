import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

export const ORGANIZATION_TYPES = ['empresa', 'condominio'] as const
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number]

const normalizeOrganizationType = (type?: string | null): OrganizationType | undefined => {
  if (!type) return undefined
  const value = type.toString().trim().toLowerCase()

  if (['empresa', 'public', 'private', 'publica', 'privada'].includes(value)) {
    return 'empresa'
  }

  if (['condominio', 'residencial', 'residential'].includes(value)) {
    return 'condominio'
  }

  return undefined
}

const institutionListSelect = {
  id: true,
  name: true,
  type: true,
  rnc: true,
  address: true,
  phone: true,
  contact_email: true,
  representante: true,
  payroll_deduction_allowed: true,
  status_code_id: true,
  created_at: true,
} as const

const institutionDetailInclude = {
  profiles: {
    orderBy: {
      created_at: 'desc' as const,
    },
    select: {
      id: true,
      user_id: true,
      full_name: true,
      phone: true,
      client_code: true,
      monthly_credit_limit: true,
      available_credit: true,
      created_at: true,
      user: {
        select: {
          email: true,
          is_active: true,
        },
      },
    },
  },
  subscriptions: {
    orderBy: {
      created_at: 'desc' as const,
    },
    select: {
      id: true,
      status: true,
      start_date: true,
      end_date: true,
      billing_cycle: true,
      created_at: true,
    },
  },
  reports: {
    orderBy: {
      generated_at: 'desc' as const,
    },
    select: {
      id: true,
      reporting_period: true,
      report_type: true,
      total_billed: true,
      payment_status: true,
      generated_at: true,
      due_date: true,
    },
  },
  payments: {
    orderBy: {
      payment_date: 'desc' as const,
    },
    select: {
      id: true,
      amount: true,
      payment_method: true,
      reference_code: true,
      payment_date: true,
    },
  },
} as const

export const getInstitutions = async (_req: Request, res: Response) => {
  try {
    const institutions = await prisma.institution.findMany({
      select: institutionListSelect,
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(institutions)
  } catch (err) {
    console.error('Error fetching institutions:', err)
    const anyErr: any = err
    res.status(500).json({ message: 'Error fetching institutions', code: anyErr?.code ?? undefined, error: anyErr?.message ?? String(anyErr) })
  }
}

export const getInstitutionById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const institution = await prisma.institution.findUnique({
      where: { id },
      include: institutionDetailInclude,
    })

    if (!institution) {
      return res.status(404).json({ message: 'Institution not found' })
    }

    res.json(institution)
  } catch (err) {
    console.error(`Error fetching institution with id ${id}:`, err)
    const anyErr: any = err
    res.status(500).json({ message: 'Error fetching institution', code: anyErr?.code ?? undefined, error: anyErr?.message ?? String(anyErr) })
  }
}

export const createInstitution = async (req: Request, res: Response) => {
  const {
    name,
    type,
    payroll_deduction_allowed,
    rnc,
    address,
    phone,
    contact_email,
    representante,
    cargo_representante,
    limite_credito_mensual,
    credito_total_asignado,
    credito_disponible,
    contact_person,
    notes,
    zone_id,
  } = req.body

  try {
    const normalizedType = normalizeOrganizationType(type)
    if (!normalizedType) {
      return res.status(400).json({
        message: 'Tipo de organización inválido. Use "empresa" o "condominio".',
        allowed: ORGANIZATION_TYPES,
      })
    }

    const payrollEnabled =
      typeof payroll_deduction_allowed === 'boolean'
        ? payroll_deduction_allowed
        : normalizedType === 'condominio'
          ? false
          : true

    const institution = await prisma.institution.create({
      data: {
        name,
        type: normalizedType,
        rnc,
        address,
        phone,
        contact_email,
        representante,
        cargo_representante,
        limite_credito_mensual: limite_credito_mensual !== undefined ? Number(limite_credito_mensual) : null,
        credito_total_asignado: credito_total_asignado !== undefined ? Number(credito_total_asignado) : null,
        credito_disponible: credito_disponible !== undefined ? Number(credito_disponible) : null,
        contact_person,
        notes,
        zone_id: zone_id ?? undefined,
        payroll_deduction_allowed: payrollEnabled,
      },
      include: institutionDetailInclude,
    })

    res.status(201).json(institution)
  } catch (err) {
    console.error('Error creating institution:', err)
    res.status(500).json({ message: 'Error creating institution' })
  }
}

export const updateInstitution = async (req: Request, res: Response) => {
  const { id } = req.params
  const {
    name,
    type,
    payroll_deduction_allowed,
    rnc,
    address,
    phone,
    contact_email,
    representante,
    cargo_representante,
    limite_credito_mensual,
    credito_total_asignado,
    credito_disponible,
    contact_person,
    notes,
    zone_id,
  } = req.body

  try {
    const normalizedType = type !== undefined ? normalizeOrganizationType(type) : undefined
    if (type !== undefined && !normalizedType) {
      return res.status(400).json({
        message: 'Tipo de organización inválido. Use "empresa" o "condominio".',
        allowed: ORGANIZATION_TYPES,
      })
    }

    const institution = await prisma.institution.update({
      where: { id },
      data: {
        name: name ?? undefined,
        type: normalizedType ?? undefined,
        rnc: rnc ?? undefined,
        address: address ?? undefined,
        phone: phone ?? undefined,
        contact_email: contact_email ?? undefined,
        representante: representante ?? undefined,
        cargo_representante: cargo_representante ?? undefined,
        limite_credito_mensual:
          limite_credito_mensual !== undefined ? Number(limite_credito_mensual) : undefined,
        credito_total_asignado:
          credito_total_asignado !== undefined ? Number(credito_total_asignado) : undefined,
        credito_disponible: credito_disponible !== undefined ? Number(credito_disponible) : undefined,
        contact_person: contact_person ?? undefined,
        notes: notes ?? undefined,
        zone_id: zone_id ?? undefined,
        payroll_deduction_allowed:
          payroll_deduction_allowed !== undefined
            ? Boolean(payroll_deduction_allowed)
            : normalizedType === 'condominio'
              ? false
              : undefined,
      },
      include: institutionDetailInclude,
    })

    res.json(institution)
  } catch (err: any) {
    console.error(`Error updating institution with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Institution not found' })
    }
    res.status(500).json({ message: 'Error updating institution' })
  }
}

export const deleteInstitution = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.institution.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting institution with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Institution not found' })
    }
    res.status(500).json({ message: 'Error deleting institution' })
  }
}

export const getOrganizationTypes = async (_req: Request, res: Response) => {
  res.json({ types: ORGANIZATION_TYPES })
}
