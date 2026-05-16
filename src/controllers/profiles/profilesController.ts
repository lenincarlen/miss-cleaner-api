import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

type ProfileCreateInput = {
  user_id: string
  full_name?: string | null
  phone?: string | null
  cedula?: string | null
  expo_push_token?: string | null
  institution_id?: string | null
  plant_id?: string | null
  zone_id?: string | null
  monthly_credit_limit?: number | null
  available_credit?: number | null
  payment_mode?: 'payroll' | 'self_pay'
}

type ProfileUpdateInput = Partial<ProfileCreateInput>

// Get all profiles
export const getProfiles = async (req: Request, res: Response) => {
  try {
    const { role } = req.query as { role?: string }

    const include = {
      institution: true,
      user: {
        include: {
          role: true,
          user_roles: {
            include: { role: true },
          },
        },
      },
      client_bags: true,
    } as const

    const roleName = role ? String(role) : null
    const where = roleName
      ? {
          OR: [
            { user: { role: { name: { equals: roleName, mode: 'insensitive' as const } } } },
            { user: { user_roles: { some: { role: { name: { equals: roleName, mode: 'insensitive' as const } } } } } },
          ],
        }
      : undefined

    const profiles = await prisma.profile.findMany({
      where: where as any,
      include,
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(profiles)
  } catch (err) {
    console.error('Error fetching profiles:', err)
    res.status(500).json({ message: 'Error fetching profiles' })
  }
}

// Get profile by ID
export const getProfileById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const profile = await prisma.profile.findUnique({
      where: { id },
      include: {
        institution: true,
        user: true,
        client_bags: true,
      },
    })

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' })
    }

    res.json(profile)
  } catch (err) {
    console.error(`Error fetching profile with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching profile' })
  }
}

// Create a new profile
export const createProfile = async (req: Request, res: Response) => {
  const {
    user_id,
    full_name,
    phone,
    cedula,
    expo_push_token,
    institution_id,
    plant_id,
    zone_id,
    monthly_credit_limit,
    available_credit,
    payment_mode,
  }: ProfileCreateInput = req.body

  try {
    let resolvedPaymentMode: 'payroll' | 'self_pay' | undefined = undefined
    if (payment_mode) {
      if (!['payroll', 'self_pay'].includes(payment_mode)) {
        return res.status(400).json({ message: 'payment_mode debe ser "payroll" o "self_pay"' })
      }
      resolvedPaymentMode = payment_mode as any
    }

    if (resolvedPaymentMode === undefined && institution_id) {
      const inst = await prisma.institution.findUnique({
        where: { id: institution_id },
        select: { payroll_deduction_allowed: true },
      })
      resolvedPaymentMode = inst?.payroll_deduction_allowed === false ? 'self_pay' : 'payroll'
    }

    const profile = await prisma.profile.create({
      data: {
        user: {
          connect: { id: user_id },
        },
        full_name: full_name ?? '',
        phone: phone ?? undefined,
        cedula: cedula ?? undefined,
        expo_push_token: expo_push_token ?? undefined,
        institution: institution_id ? { connect: { id: institution_id } } : undefined,
        plant: plant_id ? { connect: { id: plant_id } } : undefined,
        zone: zone_id ? { connect: { id: zone_id } } : undefined,
        monthly_credit_limit: monthly_credit_limit ?? undefined,
        available_credit: available_credit ?? undefined,
        payment_mode: resolvedPaymentMode,
      },
      include: {
        institution: true,
        zone: true,
        user: true,
        client_bags: true,
      },
    })

    res.status(201).json(profile)
  } catch (err: any) {
    console.error('Error creating profile:', err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'User or institution not found' })
    }
    res.status(500).json({ message: 'Error creating profile' })
  }
}

// Update a profile
export const updateProfile = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: ProfileUpdateInput = req.body

  try {
    let resolvedPaymentMode: 'payroll' | 'self_pay' | undefined = undefined
    if (data.payment_mode) {
      if (!['payroll', 'self_pay'].includes(data.payment_mode)) {
        return res.status(400).json({ message: 'payment_mode debe ser "payroll" o "self_pay"' })
      }
      resolvedPaymentMode = data.payment_mode as any
    }

    if ((data.institution_id || resolvedPaymentMode) && !resolvedPaymentMode) {
      const inst = data.institution_id
        ? await prisma.institution.findUnique({ where: { id: data.institution_id }, select: { payroll_deduction_allowed: true } })
        : await prisma.profile.findUnique({
            where: { id },
            select: { institution: { select: { payroll_deduction_allowed: true } } },
          })

      const payrollAllowed = (inst as any)?.payroll_deduction_allowed ?? (inst as any)?.institution?.payroll_deduction_allowed
      if (payrollAllowed === false && resolvedPaymentMode === 'payroll') {
        return res.status(400).json({ message: 'La organización no permite descuentos por nómina' })
      }
      resolvedPaymentMode = payrollAllowed === false ? 'self_pay' : resolvedPaymentMode
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        full_name: data.full_name ?? undefined,
        phone: data.phone ?? undefined,
        cedula: data.cedula ?? undefined,
        expo_push_token: data.expo_push_token === null ? null : data.expo_push_token ?? undefined,
        institution: data.institution_id ? { connect: { id: data.institution_id } } : undefined,
        plant: data.plant_id === null
          ? { disconnect: true }
          : (data.plant_id ? { connect: { id: data.plant_id } } : undefined),
        zone: data.zone_id === null
          ? { disconnect: true }
          : (data.zone_id ? { connect: { id: data.zone_id } } : undefined),
        monthly_credit_limit: data.monthly_credit_limit ?? undefined,
        available_credit: data.available_credit ?? undefined,
        payment_mode: resolvedPaymentMode ?? undefined,
      },
      include: {
        institution: true,
        zone: true,
        plant: true,
        user: true,
        client_bags: true,
      },
    })

    res.json(profile)
  } catch (err: any) {
    console.error(`Error updating profile with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Profile not found' })
    }
    res.status(500).json({ message: 'Error updating profile' })
  }
}

// Delete a profile
export const deleteProfile = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.profile.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting profile with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Profile not found' })
    }
    res.status(500).json({ message: 'Error deleting profile' })
  }
}
