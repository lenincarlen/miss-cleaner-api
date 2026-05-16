import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { CardnetService } from '../integrations/cardnetController'
import { extractCookieValue, normalizeBigInts } from '../../utils/serialization'

type ClientCreateInput = {
  institutionId: string
  email: string
  password: string
  full_name: string
  phone?: string | null
  cedula?: string | null
  monthly_credit_limit?: number | null
  available_credit?: number | null
  payment_mode?: 'payroll' | 'self_pay'
}

type ClientUpdateInput = {
  full_name?: string
  phone?: string | null
  cedula?: string | null
  institution_id?: string | null
  monthly_credit_limit?: number | null
  available_credit?: number | null
  client_code?: string | null
  email?: string
  password?: string
  payment_mode?: 'payroll' | 'self_pay'
}

type DecodedToken = {
  sub?: string
}

type CurrentClientContext = {
  userId: string
  email: string
  profile: {
    id: string
    full_name: string
    phone: string | null
    address: string | null
    monthly_credit_limit: unknown
    available_credit: unknown
    payment_mode: string | null
    institution: {
      id: string
      name: string
      contact_email: string | null
      payroll_deduction_allowed: boolean
    } | null
  }
}

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0 ? process.env.JWT_SECRET : 'dev-secret-key'
const cardnetService = CardnetService.getInstance()

const extractToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  const tokenFromCookies =
    req.cookies?.['miss-cleaner__admin'] ??
    req.cookies?.['miss-cleaner__web'] ??
    extractCookieValue(req.headers.cookie, 'miss-cleaner__admin') ??
    extractCookieValue(req.headers.cookie, 'miss-cleaner__web')

  return tokenFromHeader ?? tokenFromCookies ?? null
}

const getAuthenticatedUserId = (req: Request) => {
  const token = extractToken(req)

  if (!token) {
    return null
  }

  const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken
  return decoded.sub ?? null
}

const getCurrentClientContext = async (req: Request): Promise<CurrentClientContext | null> => {
  const userId = getAuthenticatedUserId(req)

  if (!userId) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      profiles: {
        take: 1,
        select: {
          id: true,
          full_name: true,
          phone: true,
          address: true,
          monthly_credit_limit: true,
          available_credit: true,
          payment_mode: true,
          institution: {
            select: {
              id: true,
              name: true,
              contact_email: true,
              payroll_deduction_allowed: true,
            },
          },
        },
      },
    },
  })

  const profile = user?.profiles?.[0]

  if (!user || !profile) {
    return null
  }

  return {
    userId: user.id,
    email: user.email,
    profile,
  }
}

const verifyPassword = async (rawPassword: string, hashedPassword: string) => {
  if (!hashedPassword) return false

  const isBcryptHash = hashedPassword.startsWith('$2')
  if (isBcryptHash) {
    return bcrypt.compare(rawPassword, hashedPassword)
  }

  return rawPassword === hashedPassword
}

const inferCardBrand = (pan: string) => {
  const normalized = pan.replace(/\s+/g, '')

  if (/^4\d{12}(\d{3})?$/.test(normalized)) return 'Visa'
  if (/^5[1-5]\d{14}$/.test(normalized) || /^2(2[2-9]|[3-6]\d|7[01])\d{12}$/.test(normalized)) return 'Mastercard'
  if (/^3[47]\d{13}$/.test(normalized)) return 'American Express'
  if (/^6(?:011|5\d{2})\d{12}$/.test(normalized)) return 'Discover'

  return 'Tarjeta'
}

const parseExpiration = (value?: string) => {
  const normalized = String(value ?? '').trim()
  const match = normalized.match(/^(\d{2})\/?(\d{2}|\d{4})$/)

  if (!match) {
    return null
  }

  const month = Number(match[1])
  const rawYear = Number(match[2])
  const year = match[2].length === 2 ? 2000 + rawYear : rawYear

  if (!Number.isInteger(month) || month < 1 || month > 12 || year < new Date().getFullYear()) {
    return null
  }

  return { month, year }
}

const buildCardnetCustomerId = (source: string) => {
  let hash = 0

  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647
  }

  return Math.max(hash, 1)
}

const ensureSingleDefaultPaymentMethod = async (profileId: string, newDefaultId?: string) => {
  if (!newDefaultId) return

  await prisma.paymentMethod.updateMany({
    where: {
      profile_id: profileId,
      id: { not: newDefaultId },
    },
    data: {
      is_default: false,
    },
  })
}

const paymentMethodSelect = {
  id: true,
  provider: true,
  cardholder_name: true,
  brand: true,
  last4: true,
  exp_month: true,
  exp_year: true,
  is_default: true,
  created_at: true,
} as const

const isMissingPaymentMethodsTableError = (err: any) =>
  err?.code === 'P2021' && typeof err?.message === 'string' && err.message.includes('payment_methods')

const listPaymentMethodsForProfile = async (profileId: string) => {
  try {
    return await prisma.paymentMethod.findMany({
      where: {
        profile_id: profileId,
      },
      select: paymentMethodSelect,
      orderBy: [
        { is_default: 'desc' },
        { created_at: 'desc' },
      ],
    })
  } catch (err) {
    if (isMissingPaymentMethodsTableError(err)) {
      return []
    }

    throw err
  }
}

const createClientWithInstitution = async (data: ClientCreateInput) => {
  const role = await prisma.role.findUnique({
    where: { name: 'institution_employee' },
  })

  if (!role) {
    throw new Error('Institution employee role not found')
  }

  const hashedPassword = await bcrypt.hash(data.password, 10)

  return prisma.$transaction(async (tx: any) => {
    const institution = await tx.institution.findUnique({
      where: { id: data.institutionId },
      select: { payroll_deduction_allowed: true },
    })

    if (!institution) {
      throw new Error('Institution not found')
    }

    if (data.payment_mode && !['payroll', 'self_pay'].includes(data.payment_mode)) {
      throw new Error('payment_mode must be "payroll" or "self_pay"')
    }

    if (institution.payroll_deduction_allowed === false && data.payment_mode === 'payroll') {
      throw new Error('Esta organización no permite descuentos por nómina')
    }

    const paymentMode: 'payroll' | 'self_pay' =
      data.payment_mode ?? (institution.payroll_deduction_allowed ? 'payroll' : 'self_pay')

    const monthlyCredit = data.monthly_credit_limit ?? 0
    const availableCredit = data.available_credit ?? data.monthly_credit_limit ?? monthlyCredit

    const user = await tx.user.create({
      data: {
        email: data.email,

        password_hash: hashedPassword,
        role_id: role.id,
        is_active: true,
      },
    })

    const profile = await tx.profile.create({
      data: {
        user_id: user.id,
        full_name: data.full_name,
        phone: data.phone ?? null,
        cedula: data.cedula ?? null,
        institution_id: data.institutionId,
        monthly_credit_limit: monthlyCredit,
        available_credit: availableCredit,
        payment_mode: paymentMode,
      },
      include: {
        institution: true,
        user: {
          include: {
            role: true,
          },
        },
        client_bags: true,
      },
    })

    return profile
  })
}

const baseProfileInclude = {
  institution: true,
  client_bags: true,
  orders: {
    include: {
      client_bag: true,
    },
  },
}

const clientListInclude = {
  institution: true,
  client_bags: true,
}

const userSelect = {
  id: true,
  email: true,
  is_active: true,
  role: true,
} as const

const attachUsersToProfiles = async <T extends { user_id?: string | null }>(profiles: T[]) => {
  const userIds = [...new Set(profiles.map((profile) => profile.user_id).filter((value): value is string => Boolean(value)))]

  if (userIds.length === 0) {
    return profiles.map((profile) => ({ ...profile, user: null }))
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
    select: userSelect,
  })

  const usersById = new Map(users.map((user) => [user.id, user]))

  return profiles.map((profile) => ({
    ...profile,
    user: profile.user_id ? usersById.get(profile.user_id) ?? null : null,
  }))
}

const getClientResponseById = async (id: string) => {
  const profile = await prisma.profile.findUnique({
    where: { id },
    include: baseProfileInclude,
  })

  if (!profile) {
    return null
  }

  const [client] = await attachUsersToProfiles([profile])
  return client
}

export const getClients = async (_req: Request, res: Response) => {
  try {
    const profiles = await prisma.profile.findMany({
      where: {
        institution_id: { not: null },
      },
      include: clientListInclude,
      orderBy: {
        created_at: 'desc',
      },
    })

    const clients = await attachUsersToProfiles(profiles)

    res.json(clients)
  } catch (err: any) {
    console.error('Error fetching clients:', err)
    res.status(500).json({
      message: 'Error fetching clients',
      detail: process.env.NODE_ENV !== 'production' ? err?.message ?? String(err) : undefined,
    })
  }
}

export const getClientById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    // Validate UUID format to avoid Prisma P2023 errors
    const uuidRegex = /^[0-9a-fA-F-]{36}$/
    if (!id || !uuidRegex.test(id)) {
      console.warn('Invalid client id format received in getClientById', { id })
      return res.status(400).json({ message: 'Invalid client id' })
    }

    const client = await getClientResponseById(id)

    if (!client || !client.institution_id) {
      return res.status(404).json({ message: 'Client not found' })
    }

    res.json(client)
  } catch (err) {
    console.error(`Error fetching client with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching client' })
  }
}

export const createClient = async (req: Request, res: Response) => {
  const {
    email,
    password_hash,
    full_name,
    phone,
    cedula,
    institution_id,
    monthly_credit_limit,
    available_credit,
    payment_mode,
  } = req.body

  if (!institution_id) {
    return res.status(400).json({ message: 'institution_id is required' })
  }

  try {
    const profile = await createClientWithInstitution({
      institutionId: institution_id,
      email,
      password: password_hash,
      full_name,
      phone,
      cedula,
      monthly_credit_limit: monthly_credit_limit !== undefined ? Number(monthly_credit_limit) : undefined,
      available_credit: available_credit !== undefined ? Number(available_credit) : undefined,
      payment_mode,
    })

    res.status(201).json(profile)
  } catch (err: any) {
    console.error('Error creating client:', err)
    if (typeof err?.message === 'string' && err.message.includes('no permite descuentos')) {
      return res.status(400).json({ message: err.message })
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'Email already exists' })
    }
    res.status(500).json({ message: 'Error creating client' })
  }
}

export const createClientForInstitution = async (req: Request, res: Response) => {
  const { institutionId } = req.params
  const {
    email,
    password,
    full_name,
    phone,
    cedula,
    monthly_credit_limit,
    available_credit,
    payment_mode,
  } = req.body

  if (!institutionId) {
    return res.status(400).json({ message: 'Institution ID is required' })
  }

  try {
    const profile = await createClientWithInstitution({
      institutionId,
      email,
      password,
      full_name,
      phone,
      cedula,
      monthly_credit_limit: monthly_credit_limit !== undefined ? Number(monthly_credit_limit) : undefined,
      available_credit: available_credit !== undefined ? Number(available_credit) : undefined,
      payment_mode,
    })

    res.status(201).json(profile)
  } catch (err: any) {
    console.error('Error creating client for institution:', err)
    if (typeof err?.message === 'string' && err.message.includes('no permite descuentos')) {
      return res.status(400).json({ message: err.message })
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'Email already exists' })
    }
    res.status(500).json({ message: 'Error creating client for institution' })
  }
}

export const updateClient = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: ClientUpdateInput = req.body

  try {
    if (data.payment_mode && !['payroll', 'self_pay'].includes(data.payment_mode)) {
      return res.status(400).json({ message: 'payment_mode debe ser "payroll" o "self_pay"' })
    }

    let enforcedPaymentMode: 'payroll' | 'self_pay' | undefined = undefined
    if (data.institution_id || data.payment_mode) {
      const institution = data.institution_id
        ? await prisma.institution.findUnique({
            where: { id: data.institution_id },
            select: { payroll_deduction_allowed: true },
          })
        : await prisma.profile.findUnique({
            where: { id },
            select: { institution_id: true, institution: { select: { payroll_deduction_allowed: true } } },
          })

      const payrollAllowed = institution && 'payroll_deduction_allowed' in institution
        ? (institution as any).payroll_deduction_allowed
        : (institution as any)?.institution?.payroll_deduction_allowed

      if (payrollAllowed === false && data.payment_mode === 'payroll') {
        return res.status(400).json({ message: 'La organización no permite descuentos por nómina, use payment_mode = "self_pay"' })
      }

      enforcedPaymentMode = payrollAllowed === false ? 'self_pay' : data.payment_mode
    }

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        full_name: data.full_name ?? undefined,
        phone: data.phone ?? undefined,
        cedula: data.cedula ?? undefined,
        institution_id: data.institution_id ?? undefined,
        monthly_credit_limit: data.monthly_credit_limit ?? undefined,
        available_credit: data.available_credit ?? undefined,
        client_code: data.client_code ?? undefined,
        payment_mode: enforcedPaymentMode ?? data.payment_mode ?? undefined,
      },
      include: baseProfileInclude,
    })

    if (profile.user_id && (data.email || data.password)) {
      const updateUser: { email?: string; password_hash?: string } = {}

      if (data.email) {
        updateUser.email = data.email
      }

      if (data.password) {
        updateUser.password_hash = await bcrypt.hash(data.password, 10)
      }

      await prisma.user.update({
        where: { id: profile.user_id },
        data: updateUser,
      })
    } else if (!profile.user_id && (data.email || data.password)) {
      return res.status(400).json({ message: 'El perfil no tiene usuario asociado para actualizar' })
    }

    res.json(profile)
  } catch (err: any) {
    console.error(`Error updating client with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Client not found' })
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'Email already exists' })
    }
    res.status(500).json({ message: 'Error updating client' })
  }
}

export const deleteClient = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { user_id: true },
    })

    if (!profile) {
      return res.status(404).json({ message: 'Client not found' })
    }

    if (profile.user_id) {
      await prisma.user.delete({
        where: { id: profile.user_id },
      })
    } else {
      await prisma.profile.delete({ where: { id } })
    }

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting client with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Client not found' })
    }
    res.status(500).json({ message: 'Error deleting client' })
  }
}

export const getClientsByInstitution = async (req: Request, res: Response) => {
  const { institutionId } = req.params

  try {
    const profiles = await prisma.profile.findMany({
      where: {
        institution_id: institutionId,
      },
      include: clientListInclude,
      orderBy: {
        created_at: 'desc',
      },
    })

    const clients = await attachUsersToProfiles(profiles)

    res.json(clients)
  } catch (err: any) {
    console.error(`Error fetching clients for institution ${institutionId}:`, err)
    res.status(500).json({
      message: 'Error fetching clients',
      detail: process.env.NODE_ENV !== 'production' ? err?.message ?? String(err) : undefined,
    })
  }
}

export const updateClientCredit = async (req: Request, res: Response) => {
  const { id } = req.params
  const { available_credit, monthly_credit_limit } = req.body

  try {
    const client = await prisma.profile.update({
      where: { id },
      data: {
        available_credit: available_credit !== undefined ? Number(available_credit) : undefined,
        monthly_credit_limit: monthly_credit_limit !== undefined ? Number(monthly_credit_limit) : undefined,
      },
      include: baseProfileInclude,
    })

    res.json(client)
  } catch (err: any) {
    console.error(`Error updating client credit with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Client not found' })
    }
    res.status(500).json({ message: 'Error updating client credit' })
  }
}

export const getCurrentClientAccount = async (req: Request, res: Response) => {
  try {
    const currentClient = await getCurrentClientContext(req)

    if (!currentClient) {
      return res.status(401).json({ message: 'No autorizado' })
    }

    const paymentMethods = await listPaymentMethodsForProfile(currentClient.profile.id)

    res.json(
      normalizeBigInts({
        id: currentClient.userId,
        email: currentClient.email,
        profile: currentClient.profile,
        payment_methods: paymentMethods,
      })
    )
  } catch (err) {
    console.error('Error fetching current client account:', err)
    res.status(500).json({ message: 'Error fetching current client account' })
  }
}

export const changeCurrentClientPassword = async (req: Request, res: Response) => {
  const { current_password, new_password, confirm_password } = req.body as {
    current_password?: string
    new_password?: string
    confirm_password?: string
  }

  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({ message: 'Debe completar la contraseña actual, la nueva y la confirmación' })
  }

  if (new_password.length < 8) {
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres' })
  }

  if (new_password !== confirm_password) {
    return res.status(400).json({ message: 'La confirmación de la contraseña no coincide' })
  }

  if (new_password === current_password) {
    return res.status(400).json({ message: 'La nueva contraseña debe ser diferente a la actual' })
  }

  try {
    const currentClient = await getCurrentClientContext(req)

    if (!currentClient) {
      return res.status(401).json({ message: 'No autorizado' })
    }

    const user = await prisma.user.findUnique({
      where: { id: currentClient.userId },
      select: { id: true, password_hash: true },
    })

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    const isValid = await verifyPassword(current_password, user.password_hash)

    if (!isValid) {
      return res.status(400).json({ message: 'La contraseña actual no es correcta' })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: await bcrypt.hash(new_password, 10),
      },
    })

    res.json({ message: 'Contraseña actualizada correctamente' })
  } catch (err) {
    console.error('Error changing current client password:', err)
    res.status(500).json({ message: 'Error updating password' })
  }
}

export const getCurrentClientPaymentMethods = async (req: Request, res: Response) => {
  try {
    const currentClient = await getCurrentClientContext(req)

    if (!currentClient) {
      return res.status(401).json({ message: 'No autorizado' })
    }

    const paymentMethods = await listPaymentMethodsForProfile(currentClient.profile.id)

    res.json(normalizeBigInts(paymentMethods))
  } catch (err) {
    console.error('Error fetching current client payment methods:', err)
    res.status(500).json({ message: 'Error fetching payment methods' })
  }
}

export const createCurrentClientPaymentMethod = async (req: Request, res: Response) => {
  const {
    pan,
    cvv,
    expiration,
    cardholder_name,
    brand,
    is_default,
  } = req.body as {
    pan?: string
    cvv?: string
    expiration?: string
    cardholder_name?: string
    brand?: string
    is_default?: boolean
  }

  const normalizedPan = String(pan ?? '').replace(/\s+/g, '')
  const normalizedCvv = String(cvv ?? '').trim()
  const expirationData = parseExpiration(expiration)

  if (!/^\d{13,19}$/.test(normalizedPan)) {
    return res.status(400).json({ message: 'El número de tarjeta no es válido' })
  }

  if (!/^\d{3,4}$/.test(normalizedCvv)) {
    return res.status(400).json({ message: 'El CVV no es válido' })
  }

  if (!expirationData) {
    return res.status(400).json({ message: 'La expiración debe tener formato MM/AA o MM/AAAA' })
  }

  try {
    const currentClient = await getCurrentClientContext(req)

    if (!currentClient) {
      return res.status(401).json({ message: 'No autorizado' })
    }

    const customerId = buildCardnetCustomerId(currentClient.profile.id)
    const cardnetResult = await cardnetService.tokenizeDirect(
      currentClient.email,
      normalizedPan,
      normalizedCvv,
      `${String(expirationData.month).padStart(2, '0')}${String(expirationData.year).slice(-2)}`,
      cardholder_name?.trim() || currentClient.profile.full_name,
      customerId
    )

    const token = cardnetResult?.Token?.TokenId

    if (!token) {
      return res.status(502).json({ message: 'No se recibió un token válido de CardNet' })
    }

    const existingCount = await prisma.paymentMethod.count({
      where: { profile_id: currentClient.profile.id },
    })

    const shouldBeDefault = typeof is_default === 'boolean' ? is_default : existingCount === 0

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        profile_id: currentClient.profile.id,
        provider: 'cardnet',
        token,
        cardholder_name: cardholder_name?.trim() || currentClient.profile.full_name,
        brand: brand?.trim() || inferCardBrand(normalizedPan),
        last4: normalizedPan.slice(-4),
        exp_month: expirationData.month,
        exp_year: expirationData.year,
        is_default: shouldBeDefault,
      },
      select: paymentMethodSelect,
    })

    if (shouldBeDefault) {
      await ensureSingleDefaultPaymentMethod(currentClient.profile.id, paymentMethod.id)
    }

    res.status(201).json(normalizeBigInts(paymentMethod))
  } catch (err: any) {
    console.error('Error creating current client payment method:', err)

    if (isMissingPaymentMethodsTableError(err)) {
      return res.status(503).json({
        message: 'Los metodos de pago aun no estan habilitados en el backend. Falta aplicar la migracion correspondiente.',
      })
    }

    if (err?.code === 'P2002') {
      return res.status(400).json({ message: 'Esta tarjeta ya fue agregada previamente' })
    }

    res.status(err?.status || 500).json({
      message: err?.data?.Errors?.[0]?.Message || err?.message || 'Error creating payment method',
    })
  }
}

export const deleteCurrentClientPaymentMethod = async (req: Request, res: Response) => {
  const { paymentMethodId } = req.params

  try {
    const currentClient = await getCurrentClientContext(req)

    if (!currentClient) {
      return res.status(401).json({ message: 'No autorizado' })
    }

    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        profile_id: currentClient.profile.id,
      },
      select: {
        id: true,
        is_default: true,
      },
    })

    if (!paymentMethod) {
      return res.status(404).json({ message: 'Método de pago no encontrado' })
    }

    await prisma.paymentMethod.delete({
      where: { id: paymentMethod.id },
    })

    if (paymentMethod.is_default) {
      const fallbackMethod = await prisma.paymentMethod.findFirst({
        where: {
          profile_id: currentClient.profile.id,
        },
        orderBy: {
          created_at: 'desc',
        },
        select: { id: true },
      })

      if (fallbackMethod) {
        await prisma.paymentMethod.update({
          where: { id: fallbackMethod.id },
          data: { is_default: true },
        })
      }
    }

    res.status(204).send()
  } catch (err) {
    console.error('Error deleting current client payment method:', err)
    if (isMissingPaymentMethodsTableError(err)) {
      return res.status(503).json({
        message: 'Los metodos de pago aun no estan habilitados en el backend. Falta aplicar la migracion correspondiente.',
      })
    }
    res.status(500).json({ message: 'Error deleting payment method' })
  }
}
