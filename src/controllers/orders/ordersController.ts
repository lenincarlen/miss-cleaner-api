import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { sendOrderStatusPush } from '../../lib/expoPush'
import { normalizeBigInts } from '../../utils/serialization'
import { generateConfirmationCode, isValidConfirmationCode, normalizeCode } from '../../lib/confirmationCodes'

type OrderItemInput = {
  description: string
  quantity: number | string
  unit_price: number | string
  service_id?: string | null
  service_variant_id?: string | null
  notes?: string | null
}

type OrderCreateInput = {
  profile_id: string
  institution_id: string
  plant_id?: string | null
  subscription_id?: string | null
  client_bag_id?: string | null
  currency_id?: string | null
  service_type?: string | null
  status?: string | null
  extra_options?: any
  special_instructions?: string | null
  estimated_delivery_date?: string | null
  order_items?: OrderItemInput[]
  // opcionales (serán recalculados en el servidor si no se envían)
  discount_amount?: number | string | null
  tax_amount?: number | string | null
  total_price?: number | string | null
  total_amount?: number | string | null
}

type OrderUpdateInput = {
  plant_id?: string | null
  subscription_id?: string | null
  client_bag_id?: string | null
  currency_id?: string | null
  service_type?: string | null
  status?: string | null
  extra_options?: any
  special_instructions?: string | null
  estimated_delivery_date?: string | null
  picked_up_at?: string | null
  ready_at?: string | null
  delivered_at?: string | null
  weight_lbs?: number | string | null
  discount_amount?: number | string | null
  tax_amount?: number | string | null
  total_price?: number | string | null
  total_amount?: number | string | null
}

const orderInclude = Prisma.validator<Prisma.OrderInclude>()({
  profile: {
    select: {
      id: true,
      full_name: true,
      available_credit: true,
    },
  },
  institution: {
    select: {
      id: true,
      name: true,
    },
  },
  plant: {
    select: {
      id: true,
      name: true,
    },
  },
  subscription: {
    select: {
      id: true,
      status: true,
      start_date: true,
      end_date: true,
    },
  },
  client_bag: {
    select: {
      id: true,
      bag_number: true,
    },
  },
  currency: {
    select: {
      id: true,
      iso_code: true,
      symbol: true,
      name: true,
    },
  },
  order_items: {
    include: {
      service: {
        select: {
          id: true,
          name: true,
        },
      },
      service_variant: {
        select: {
          id: true,
          name: true,
          price: true,
          icon_name: true,
        },
      },
    },
  },
  deliveries: true,
} as const);

// Los nuevos campos ya están incluidos por defecto en la respuesta base
// No es necesario especificarlos en el include porque son parte del modelo Order
function toInt(value: number | string): number {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value
  if (Number.isNaN(parsed) || parsed === null) {
    return 0
  }
  return parsed
}

function toDecimal(value: number | string | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0)
}

function toDateTime(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const normalized = typeof value === 'string' ? value.trim() : value
  if (!normalized) return null
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

const createTrackingEntry = async (
  orderId: string,
  fromStatus: string,
  toStatus: string,
  notes?: string | null,
  changedByProfileId?: string | null
) => {
  try {
    await prisma.orderTracking.create({
      data: {
        order_id: orderId,
        status_from: fromStatus,
        status_to: toStatus,
        notes: notes ?? undefined,
        changed_by_profile_id: changedByProfileId ?? undefined,
      },
    })
    await sendOrderStatusPush(orderId, toStatus)
  } catch (err) {
    console.error('Failed to create tracking entry:', err)
    // No lanzar error para no bloquear la operación principal
  }
}

// Get all orders
export const getOrders = async (req: Request, res: Response) => {
  const { institution_id, plant_id, zone_id, date_from, date_to, status, profile_id } = req.query as {
    institution_id?: string
    plant_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
    status?: string
    profile_id?: string
  }

  try {
    const where: Prisma.OrderWhereInput = {}

    if (institution_id) {
      where.institution_id = institution_id
    }

    if (plant_id) {
      where.plant_id = plant_id
    }

    if (zone_id) {
      where.zone_id = zone_id
    }

    if (status) {
      where.status = status
    }

    if (profile_id) {
      where.profile_id = profile_id
    }

    if (date_from || date_to) {
      where.created_at = {
        gte: date_from ? new Date(date_from) : undefined,
        lte: date_to ? new Date(date_to) : undefined,
      }
    }

    const orders = await prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(normalizeBigInts(orders))
  } catch (err) {
    console.error('Error fetching orders:', err)
    const anyErr: any = err
    res.status(500).json({
      message: 'Error fetching orders',
      code: anyErr?.code ?? undefined,
      error: anyErr?.message ?? String(anyErr),
    })
  }
}

// Get order by ID
export const getOrderById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    })

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    res.json(normalizeBigInts(order))
  } catch (err) {
    console.error(`Error fetching order with id ${id}:`, err)
    const anyErr: any = err
    res.status(500).json({
      message: 'Error fetching order',
      code: anyErr?.code ?? undefined,
      error: anyErr?.message ?? String(anyErr),
    })
  }
}

// Create a new order
export const createOrder = async (req: Request, res: Response) => {
  const {
    profile_id,
    institution_id,
    plant_id,
    subscription_id,
    client_bag_id,
    currency_id,
    service_type,
    status,
    extra_options,
    special_instructions,
    estimated_delivery_date,
    order_items,
    discount_amount,
    tax_amount,
    total_price,
    total_amount,
  }: OrderCreateInput = req.body

  try {
    const order = await prisma.$transaction(async (tx: any) => {
      // 1) Auto-asignación por zona (antes de crear la orden): seleccionar zona, planta y courier
      const requestedServiceIds = Array.from(
        new Set((order_items ?? [])
          .map((it) => it.service_id)
          .filter((v): v is string => Boolean(v)))
      )

      const institution = await tx.institution.findUnique({
        where: { id: institution_id },
        select: {
          id: true,
          address: true,
          city_id: true,
          zone_id: true,
          city: { select: { name: true } },
        },
      })

      // Priorizar zone_id de la institución; si no existe, mapear por nombre de ciudad
      let selectedZoneId: string | null = institution?.zone_id ?? null
      if (!selectedZoneId && institution?.city?.name) {
        try {
          const z = await tx.zone.findFirst({
            where: { 
              city: { 
                equals: institution.city.name, 
                mode: 'insensitive' 
              } 
            },
            select: { id: true },
          })
          selectedZoneId = z?.id ?? null
        } catch (zoneErr) {
          // Si falla la búsqueda por ciudad, continuar sin zona
          console.warn('Could not find zone by city name:', institution.city.name, zoneErr)
        }
      }

      const candidatePlants = await tx.plant.findMany({
        where: {
          status: 'active',
          is_active: true,
          ...(selectedZoneId ? { zone_id: selectedZoneId } : {}),
        },
        include: { services: { select: { id: true } } },
        orderBy: { created_at: 'asc' },
      })

      const compatiblePlants = requestedServiceIds.length > 0
        ? candidatePlants.filter((p: any) => {
            const plantServiceIds = new Set((p.services ?? []).map((s: any) => s.id))
            return requestedServiceIds.every((sid) => plantServiceIds.has(sid))
          })
        : candidatePlants

      const autoPlantId: string | undefined = (plant_id ?? (compatiblePlants[0]?.id as string | undefined)) || undefined

      const autoCourier = await tx.profile.findFirst({
        where: {
          ...(institution?.city_id ? { city_id: institution.city_id } : {}),
          OR: [
            { user: { role: { name: { equals: 'delivery', mode: 'insensitive' } } } },
            { user: { user_roles: { some: { role: { name: { equals: 'delivery', mode: 'insensitive' } } } } } },
          ],
        },
        select: { id: true },
        orderBy: { created_at: 'asc' },
      })

      const createdOrder = await tx.order.create({
        data: {
          profile_id,
          institution_id,
          plant_id: autoPlantId ?? undefined,
          zone_id: selectedZoneId ?? undefined,
          subscription_id: subscription_id ?? undefined,
          client_bag_id: client_bag_id ?? undefined,
          currency_id: currency_id ?? undefined,
          service_type: service_type ?? undefined,
          status: status ?? undefined,
          extra_options,
          special_instructions: special_instructions ?? undefined,
          estimated_delivery_date: toDateTime(estimated_delivery_date),
        },
        include: orderInclude,
      })

      let subtotal = new Prisma.Decimal(0)

      if (order_items?.length) {
        for (const item of order_items) {
          const quantity = toInt(item.quantity)
          const unitPrice = toDecimal(item.unit_price)
          const itemTotal = unitPrice.mul(quantity)

          const createdItem = await tx.orderItem.create({
            data: {
              order_id: createdOrder.id,
              description: item.description,
              quantity,
              unit_price: unitPrice,
              total_price: itemTotal,
              service_id: item.service_id ?? undefined,
            service_variant_id: item.service_variant_id ?? undefined,
              notes: item.notes,
            },
          })

          subtotal = subtotal.add(itemTotal)
        }
      }

      // Calcular totales/impuestos
      const discount = toDecimal(discount_amount ?? 0)
      const providedTotalPrice = total_price != null ? toDecimal(total_price as any) : undefined
      const providedTaxAmount = tax_amount != null ? toDecimal(tax_amount as any) : undefined

      // Base imponible: si viene total_price lo usamos, si no: subtotal - descuento
      const baseTotalPrice = providedTotalPrice ?? subtotal.sub(discount)

      // Tasa de impuesto (puede venir en extra_options.tax_rate), por defecto 0.18
      const taxRate = (() => {
        const maybe = (extra_options && typeof extra_options.tax_rate !== 'undefined') ? extra_options.tax_rate : undefined
        const n = typeof maybe === 'string' ? parseFloat(maybe) : (typeof maybe === 'number' ? maybe : undefined)
        if (typeof n === 'number' && !Number.isNaN(n)) return n
        return 0.18
      })()

      const computedTax = providedTaxAmount ?? baseTotalPrice.mul(new Prisma.Decimal(taxRate))
      const providedTotalAmount = total_amount != null ? toDecimal(total_amount as any) : undefined
      const finalTotalAmount = providedTotalAmount ?? baseTotalPrice.add(computedTax)

      const updatedOrder = await tx.order.update({
        where: { id: createdOrder.id },
        data: {
          // Guardamos todos los totales calculados
          total_price: baseTotalPrice,
          discount_amount: discount,
          tax_amount: computedTax,
          total_amount: finalTotalAmount,
          // Persistir zone_id si se determinó por fallback (si no se creó ya)
          zone_id: selectedZoneId ?? undefined,
          // Generar todos los códigos de confirmación al crear la orden
          pickup_confirmation_code: generateConfirmationCode(),
          plant_ready_confirmation_code: generateConfirmationCode(),
          final_delivery_confirmation_code: generateConfirmationCode(),
        },
        include: orderInclude,
      })

      // Crear registro de logística (delivery) y auto-asignar courier si existe
      try {
        await tx.delivery.create({
          data: {
            order_id: createdOrder.id,
            delivery_profile_id: autoCourier?.id ?? undefined,
            pickup_address: institution?.address ?? undefined,
            delivery_address: institution?.address ?? undefined,
            status: autoCourier?.id ? 'assigned' : 'pending',
            assigned_at: autoCourier?.id ? new Date() : undefined,
          },
        })
      } catch (err) {
        // No bloquear la creación de la orden si falla el delivery automático
        console.error('Auto-delivery creation failed for order', createdOrder.id, err)
      }

      // Decrement profile available_credit (floor at 0). If available_credit is null, fallback to monthly_credit_limit
      try {
        const profile = await tx.profile.findUnique({
          where: { id: createdOrder.profile_id },
          select: { available_credit: true, monthly_credit_limit: true, payment_mode: true },
        })

        if (profile?.payment_mode === 'self_pay') {
          return
        }
        const available = profile?.available_credit
        const limit = profile?.monthly_credit_limit
        const currentAvailable = available instanceof Prisma.Decimal
          ? available
          : (available != null
            ? new Prisma.Decimal(available as unknown as any)
            : (limit instanceof Prisma.Decimal ? limit : new Prisma.Decimal(limit ?? 0)))
        let newAvailable = currentAvailable.sub(finalTotalAmount)
        if (newAvailable.isNegative()) newAvailable = new Prisma.Decimal(0)
        await tx.profile.update({
          where: { id: createdOrder.profile_id },
          data: { available_credit: newAvailable },
        })
      } catch (err) {
        console.error('Failed to decrement available_credit for profile', {
          profile_id: createdOrder.profile_id,
          order_id: createdOrder.id,
          err,
        })
      }

      // Re-read order to include the freshly updated profile credit
      const finalOrder = await tx.order.findUnique({ where: { id: createdOrder.id }, include: orderInclude })
      return finalOrder!
    })

    res.status(201).json(order)
  } catch (err: any) {
    console.error('Error creating order:', err)
    console.error('Error stack:', err.stack)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Related entity not found' })
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ message: 'Invalid foreign key reference', details: err.meta })
    }
    res.status(500).json({ 
      message: 'Error creating order',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: err.code,
    })
  }
}

// Update an order
export const updateOrder = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: OrderUpdateInput = req.body

  try {
    // Leer orden existente para cálculos por defecto (subtotal, extra_options, valores previos)
    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        order_items: { select: { total_price: true } },
        discount_amount: true,
        tax_amount: true,
        total_price: true,
        total_amount: true,
        extra_options: true,
      },
    })

    const baseUpdate: any = {
      plant_id: data.plant_id ?? undefined,
      subscription_id: data.subscription_id ?? undefined,
      client_bag_id: data.client_bag_id ?? undefined,
      currency_id: data.currency_id ?? undefined,
      service_type: data.service_type ?? undefined,
      status: data.status ?? undefined,
      extra_options: data.extra_options ?? undefined,
      special_instructions: data.special_instructions ?? undefined,
      estimated_delivery_date: toDateTime(data.estimated_delivery_date),
      picked_up_at: toDateTime(data.picked_up_at),
      ready_at: toDateTime(data.ready_at),
      delivered_at: toDateTime(data.delivered_at),
    }

    // Si se marca como ready_for_delivery, cambiar a ready_for_pickup_by_delivery
    // para indicar que está lista para que el delivery la recoga
    if (data.status === 'ready_for_delivery') {
      const currentOrder = await prisma.order.findUnique({
        where: { id },
        select: { plant_ready_confirmation_code: true },
      })
      if (!currentOrder?.plant_ready_confirmation_code) {
        baseUpdate.plant_ready_confirmation_code = generateConfirmationCode()
      }
      if (!baseUpdate.ready_at) {
        baseUpdate.ready_at = new Date()
      }
      // Cambiar el estado a ready_for_pickup_by_delivery
      baseUpdate.status = 'ready_for_pickup_by_delivery'
    }

    // Mapear campos numéricos/decimales si se proporcionan
    if (data.weight_lbs !== undefined) {
      baseUpdate.weight_lbs = toDecimal(data.weight_lbs ?? 0)
    }
    if (data.discount_amount !== undefined) {
      baseUpdate.discount_amount = toDecimal(data.discount_amount ?? 0)
    }
    if (data.tax_amount !== undefined) {
      baseUpdate.tax_amount = toDecimal(data.tax_amount ?? 0)
    }
    if (data.total_price !== undefined) {
      baseUpdate.total_price = toDecimal(data.total_price ?? 0)
    }
    if (data.total_amount !== undefined) {
      baseUpdate.total_amount = toDecimal(data.total_amount ?? 0)
    }

    // Recalcular impuestos y total si no fueron enviados
    if (data.tax_amount === undefined || data.total_amount === undefined || data.total_price === undefined) {
      // Subtotal actual de la orden
      let subtotal = new Prisma.Decimal(0)
      for (const it of existing?.order_items ?? []) {
        const val = (it.total_price instanceof Prisma.Decimal)
          ? it.total_price
          : new Prisma.Decimal((it as any).total_price ?? 0)
        subtotal = subtotal.add(val)
      }

      // Descuento efectivo (nuevo o existente)
      const effectiveDiscount = (data.discount_amount !== undefined)
        ? toDecimal(data.discount_amount ?? 0)
        : (existing?.discount_amount instanceof Prisma.Decimal
          ? existing.discount_amount
          : new Prisma.Decimal((existing as any)?.discount_amount ?? 0))

      // Base imponible: si llega total_price, usarlo; de lo contrario subtotal - descuento
      const providedTotalPrice = (data.total_price !== undefined)
        ? toDecimal(data.total_price ?? 0)
        : undefined
      const baseTotalPrice = providedTotalPrice ?? subtotal.sub(effectiveDiscount)

      // tax_rate de extra_options (nuevo payload tiene prioridad, sino el existente). Por defecto 0.18
      const taxRateRaw = (data.extra_options && (data.extra_options as any).tax_rate !== undefined)
        ? (data.extra_options as any).tax_rate
        : (existing?.extra_options && (existing.extra_options as any).tax_rate !== undefined
          ? (existing.extra_options as any).tax_rate
          : undefined)
      const taxRateNum = typeof taxRateRaw === 'string' ? parseFloat(taxRateRaw) : (typeof taxRateRaw === 'number' ? taxRateRaw : undefined)
      const taxRate = (typeof taxRateNum === 'number' && !Number.isNaN(taxRateNum)) ? taxRateNum : 0.18

      // Cálculo de impuestos/total solo si no vinieron explícitos
      if (data.total_price === undefined) {
        baseUpdate.total_price = baseTotalPrice
      }
      if (data.tax_amount === undefined) {
        baseUpdate.tax_amount = baseTotalPrice.mul(new Prisma.Decimal(taxRate))
      }
      if (data.total_amount === undefined) {
        const taxDec = (baseUpdate.tax_amount instanceof Prisma.Decimal)
          ? baseUpdate.tax_amount
          : new Prisma.Decimal(baseUpdate.tax_amount ?? 0)
        baseUpdate.total_amount = baseTotalPrice.add(taxDec)
      }
    }

    const order = await prisma.order.update({
      where: { id },
      data: baseUpdate,
      include: orderInclude,
    })

    if (existing?.status && order.status && existing.status !== order.status) {
      await createTrackingEntry(id, existing.status, order.status, 'Estado actualizado manualmente', null)
    }

    res.json(order)
  } catch (err: any) {
    console.error(`Error updating order with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.status(500).json({ message: 'Error updating order' })
  }
}

// Delete an order
export const deleteOrder = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const existing = await prisma.order.findUnique({
      where: { id },
      select: { id: true, profile_id: true, total_amount: true },
    })

    if (!existing) {
      return res.status(404).json({ message: 'Order not found' })
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.order.delete({ where: { id } })
      // Restore available_credit by adding back the order total_amount
      if (existing.profile_id) {
        try {
          const profile = await tx.profile.findUnique({
            where: { id: existing.profile_id },
            select: { available_credit: true, payment_mode: true },
          })
          if (profile?.payment_mode === 'self_pay') {
            return
          }
          const currentAvailable = profile?.available_credit instanceof Prisma.Decimal
            ? profile.available_credit
            : new Prisma.Decimal(profile?.available_credit ?? 0)
          const addBack = existing.total_amount instanceof Prisma.Decimal
            ? existing.total_amount
            : new Prisma.Decimal(existing.total_amount ?? 0)
          const newAvailable = currentAvailable.add(addBack)
          await tx.profile.update({
            where: { id: existing.profile_id },
            data: { available_credit: newAvailable },
          })
        } catch (err) {
          console.error('Failed to restore available_credit for profile on delete', {
            profile_id: existing.profile_id,
            order_id: existing.id,
            err,
          })
        }
      }
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting order with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.status(500).json({ message: 'Error deleting order' })
  }
}

// ===== ENDPOINTS DE CONFIRMACIÓN CON CÓDIGOS =====

/**
 * 1. Confirmar recogida en institución (Delivery)
 * El delivery confirma que recogió la orden en la institución usando el código
 * Opcional: registrar peso
 */
export const confirmPickupFromInstitution = async (req: Request, res: Response) => {
  const { order_id } = req.params
  const { confirmation_code, weight_lbs, delivery_profile_id } = req.body as {
    confirmation_code: string
    weight_lbs?: number | string | null
    delivery_profile_id?: string | null
  }

  if (!confirmation_code) {
    return res.status(400).json({ message: 'Código de confirmación es requerido' })
  }

  try {
    // Enfoque simplificado: sin transacción para evitar timeouts
    // Validar primero
    const existing = await prisma.order.findUnique({
      where: { id: order_id },
      select: {
        id: true,
        status: true,
        pickup_confirmation_code: true,
        pickup_confirmed_at: true,
        deliveries: {
          take: 1,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            pickup_profile_id: true,
          },
        },
      },
    })

    if (!existing) {
      return res.status(404).json({ message: 'Orden no encontrada' })
    }

    const normalizedCode = normalizeCode(confirmation_code)
    
    // Validaciones
    if (existing.status !== 'pending_pickup') {
      return res.status(400).json({ message: `La orden no está en estado "pending_pickup". Estado actual: ${existing.status}` })
    }

    if (existing.pickup_confirmed_at) {
      return res.status(400).json({ message: 'Esta orden ya fue confirmada para recogida' })
    }

    // Validar código
    if (!existing.pickup_confirmation_code) {
      // Para órdenes antiguas sin código, generar uno nuevo
      console.warn(`Orden ${order_id} confirmada sin validación de código (orden antigua sin código)`)
    } else {
      if (existing.pickup_confirmation_code !== normalizedCode) {
        return res.status(400).json({ message: `Código de confirmación inválido. El código correcto es: ${existing.pickup_confirmation_code}` })
      }
    }

    // Generar código para recepción en planta
    let plantReceivedCode = generateConfirmationCode()
    let codeAttempts = 0
    const maxCodeAttempts = 5

    // Preparar datos de actualización
    const updateData: any = {
      status: 'in_transit',
      picked_up_at: new Date(),
      pickup_confirmed_at: new Date(),
      plant_received_confirmation_code: plantReceivedCode,
    }
    
    if (!existing.pickup_confirmation_code) {
      updateData.pickup_confirmation_code = generateConfirmationCode()
    }
    
    if (weight_lbs != null && weight_lbs !== undefined) {
      try {
        updateData.weight_lbs = toDecimal(weight_lbs)
      } catch (weightErr: any) {
        console.error('Error converting weight_lbs to Decimal:', weightErr)
      }
    }

    // Actualizar orden con reintentos para códigos únicos
    // Usar updateMany con condiciones para evitar condiciones de carrera
    let updatedOrder
    let updateSuccess = false
    
    while (codeAttempts < maxCodeAttempts && !updateSuccess) {
      try {
        // Usar update con condiciones para evitar condiciones de carrera
        const result = await prisma.order.updateMany({
          where: { 
            id: order_id,
            status: 'pending_pickup', // Condición adicional para evitar actualizaciones concurrentes
            pickup_confirmed_at: null, // Asegurar que no esté ya confirmada
          },
          data: updateData,
        })
        
        if (result.count === 0) {
          // Si no se actualizó ninguna fila, podría haber sido actualizada por otra solicitud
          // Verificar el estado actual
          const current = await prisma.order.findUnique({
            where: { id: order_id },
            select: { status: true, pickup_confirmed_at: true },
          })
          
          if (current?.status === 'in_transit' && current?.pickup_confirmed_at) {
            // Ya fue actualizada, obtener datos básicos
            updatedOrder = await prisma.order.findUnique({ 
              where: { id: order_id },
              select: { id: true, order_number: true, status: true },
            })
            updateSuccess = true
            break
          } else {
            throw new Error('No se pudo actualizar la orden. El estado podría haber cambiado.')
          }
        } else {
          // Actualización exitosa - obtener datos básicos de la orden
          updatedOrder = await prisma.order.findUnique({ 
            where: { id: order_id },
            select: { id: true, order_number: true, status: true },
          })
          updateSuccess = true
          break
        }
      } catch (updateErr: any) {
        if (updateErr.code === 'P2002' && updateErr.meta?.target?.includes('plant_received_confirmation_code')) {
          codeAttempts++
          if (codeAttempts >= maxCodeAttempts) {
            throw new Error('No se pudo generar un código único después de varios intentos')
          }
          updateData.plant_received_confirmation_code = generateConfirmationCode()
          console.warn(`Conflicto de código único, reintentando con nuevo código (intento ${codeAttempts})`)
        } else {
          throw updateErr
        }
      }
    }
    
    if (!updateSuccess || !updatedOrder) {
      throw new Error('No se pudo actualizar la orden después de varios intentos')
    }

    // Actualizar delivery si existe (no crítico)
    if (existing.deliveries?.[0]?.id) {
      try {
        await prisma.delivery.update({
          where: { id: existing.deliveries[0].id },
          data: {
            status: 'in_transit',
            pickup_profile_id: delivery_profile_id ?? existing.deliveries[0].pickup_profile_id ?? undefined,
            pickup_confirmation_code: normalizedCode,
          },
        })
      } catch (deliveryErr: any) {
        console.error('Error updating delivery (non-critical):', deliveryErr)
      }
    }
    
    // Crear tracking entry (no crítico si falla)
    try {
      await createTrackingEntry(order_id, 'pending_pickup', 'in_transit', 'Confirmada recogida en institución', delivery_profile_id)
    } catch (trackingErr: any) {
      console.error('Error creating tracking entry (non-critical):', trackingErr)
    }
    
    // Retornar respuesta exitosa inmediatamente después de la actualización
    // La orden completa se puede obtener en una solicitud separada si es necesario
    res.json({ 
      id: order_id,
      order_number: updatedOrder.order_number || null,
      status: 'in_transit',
      message: 'Recogida confirmada exitosamente',
    })
  } catch (err: any) {
    console.error('Error confirming pickup from institution:', err)
    console.error('Error stack:', err.stack)
    console.error('Error details:', {
      order_id,
      confirmation_code,
      weight_lbs,
      delivery_profile_id,
      code: err.code,
      meta: err.meta,
    })
    
    if (err.message === 'Orden no encontrada') {
      return res.status(404).json({ message: err.message })
    }
    if (err.message.includes('Código de confirmación inválido') || err.message.includes('ya fue confirmada') || err.message.includes('no está en estado')) {
      return res.status(400).json({ message: err.message })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Orden no encontrada' })
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Conflicto de datos únicos', details: err.meta })
    }
    if (err.code === 'P2028') {
      // Error de transacción (deadlock o timeout) - aunque ya no usamos transacciones, algunos errores de Prisma pueden tener este código
      console.error('Prisma error (P2028):', err.meta)
      return res.status(500).json({ 
        message: 'Error en la operación. Por favor, intenta nuevamente.',
        code: 'P2028',
        retry: true,
      })
    }
    // Log detallado del error
    const errorDetails = {
      message: err.message,
      code: err.code,
      meta: err.meta,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    }
    console.error('Full error details:', JSON.stringify(errorDetails, null, 2))
    
    res.status(500).json({ 
      message: 'Error al confirmar recogida',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: err.code,
      details: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
    })
  }
}

/**
 * 2. Confirmar recepción en planta (Planta)
 * La planta confirma que recibió la orden del delivery usando el código
 * Puede escanear o digitar el código
 */
export const confirmPlantReceived = async (req: Request, res: Response) => {
  const { order_id } = req.params
  const { confirmation_code } = req.body as {
    confirmation_code: string
  }

  if (!confirmation_code) {
    return res.status(400).json({ message: 'Código de confirmación es requerido' })
  }

  try {
    const order = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.order.findUnique({
        where: { id: order_id },
      })

      if (!existing) {
        throw new Error('Orden no encontrada')
      }

      const normalizedCode = normalizeCode(confirmation_code)
      const expectedCode = existing.plant_received_confirmation_code ? normalizeCode(existing.plant_received_confirmation_code) : null
      
      if (!expectedCode) {
        throw new Error('Esta orden no tiene código de confirmación para recepción en planta. Contacte al administrador.')
      }
      
      if (expectedCode !== normalizedCode) {
        throw new Error(`Código de confirmación inválido. El código correcto es: ${expectedCode}`)
      }

      if (!['in_transit', 'at_plant'].includes(existing.status)) {
        throw new Error(`La orden no está en estado válido para recepción en planta. Estado actual: ${existing.status}`)
      }

      if (existing.plant_received_confirmed_at) {
        throw new Error('Esta orden ya fue confirmada para recepción en planta')
      }

      // Actualizar orden
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data: {
          status: 'at_plant',
          plant_received_confirmed_at: new Date(),
        },
        include: orderInclude,
      })

      // Actualizar delivery si existe
      const delivery = await tx.delivery.findFirst({
        where: { order_id },
        orderBy: { created_at: 'desc' },
      })

      if (delivery) {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: 'at_plant',
          },
        })
      }

      await createTrackingEntry(order_id, existing.status, 'at_plant', 'Confirmada recepción en planta', null)

      return updatedOrder
    })

    res.json(normalizeBigInts(order))
  } catch (err: any) {
    console.error('Error confirming plant received:', err)
    if (err.message === 'Orden no encontrada') {
      return res.status(404).json({ message: err.message })
    }
    if (err.message.includes('Código de confirmación inválido') || 
        err.message.includes('ya fue confirmada') || 
        err.message.includes('no está en estado') ||
        err.message.includes('no tiene código de confirmación')) {
      return res.status(400).json({ message: err.message })
    }
    res.status(500).json({ message: 'Error al confirmar recepción en planta' })
  }
}

/**
 * 3. Confirmar recogida lista en planta (Delivery)
 * El delivery confirma que recogió la orden lista de la planta usando el código
 */
export const confirmPlantReadyPickup = async (req: Request, res: Response) => {
  const { order_id } = req.params
  const { confirmation_code, delivery_profile_id } = req.body as {
    confirmation_code: string
    delivery_profile_id?: string | null
  }

  if (!confirmation_code) {
    return res.status(400).json({ message: 'Código de confirmación es requerido' })
  }

  try {
    const order = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.order.findUnique({
        where: { id: order_id },
        include: {
          deliveries: {
            take: 1,
            orderBy: { created_at: 'desc' },
          },
        },
      })

      if (!existing) {
        throw new Error('Orden no encontrada')
      }

      const normalizedCode = normalizeCode(confirmation_code)
      if (existing.plant_ready_confirmation_code !== normalizedCode) {
        throw new Error('Código de confirmación inválido')
      }

      if (!['ready_for_delivery', 'ready_for_pickup_by_delivery', 'processing', 'at_plant'].includes(existing.status)) {
        throw new Error(`La orden no está en un estado válido para ser recogida de la planta. Estado actual: ${existing.status}`)
      }

      // Si el estado no es ready_for_delivery o ready_for_pickup_by_delivery, devolver error
      if (!['ready_for_delivery', 'ready_for_pickup_by_delivery'].includes(existing.status)) {
        // Este es un intento prematuro de recogida.
        // Devolvemos un error claro para que el frontend pueda manejarlo.
        return res.status(400).json({
          message: `La orden aún no está lista para ser recogida. Estado actual: ${existing.status}`,
          code: 'ORDER_NOT_READY',
        })
      }

      if (existing.plant_ready_confirmed_at) {
        throw new Error('Esta orden ya fue confirmada para recogida lista')
      }

      // Actualizar orden
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data: {
          status: 'out_for_delivery',
          plant_ready_confirmed_at: new Date(),
        },
        include: orderInclude,
      })

      // Actualizar delivery si existe
      if (existing.deliveries?.[0]?.id) {
        await tx.delivery.update({
          where: { id: existing.deliveries[0].id },
          data: {
            status: 'out_for_delivery',
            delivery_profile_id: delivery_profile_id ?? existing.deliveries[0].delivery_profile_id ?? undefined,
            delivery_confirmation_code: normalizedCode,
          },
        })
      }

      // Generar código para entrega final al cliente solo si no existe
      const currentOrderForFinalCode = await tx.order.findUnique({
        where: { id: order_id },
        select: { final_delivery_confirmation_code: true },
      })
      if (!currentOrderForFinalCode?.final_delivery_confirmation_code) {
        await tx.order.update({
          where: { id: order_id },
          data: {
            final_delivery_confirmation_code: generateConfirmationCode(),
          },
        })
      }

      await createTrackingEntry(order_id, existing.status, 'out_for_delivery', 'Confirmada recogida lista en planta', delivery_profile_id)

      return updatedOrder
    })

    res.json(normalizeBigInts(order))
  } catch (err: any) {
    console.error('Error confirming plant ready pickup:', err)
    if (err.message === 'Orden no encontrada') {
      return res.status(404).json({ message: err.message })
    }
    if (err.message.includes('Código de confirmación inválido') || err.message.includes('ya fue confirmada') || err.message.includes('no está lista')) {
      return res.status(400).json({ message: err.message })
    }
    res.status(500).json({ message: 'Error al confirmar recogida lista' })
  }
}

/**
 * 4. Confirmar entrega final (Cliente)
 * El cliente confirma que recibió la orden lista del delivery en la institución usando el código
 */
export const confirmFinalDelivery = async (req: Request, res: Response) => {
  const { order_id } = req.params
  const { confirmation_code } = req.body as {
    confirmation_code: string
  }

  if (!confirmation_code) {
    return res.status(400).json({ message: 'Código de confirmación es requerido' })
  }

  try {
    const order = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.order.findUnique({
        where: { id: order_id },
      })

      if (!existing) {
        throw new Error('Orden no encontrada')
      }

      const normalizedCode = normalizeCode(confirmation_code)
      if (existing.final_delivery_confirmation_code !== normalizedCode) {
        throw new Error('Código de confirmación inválido')
      }

      if (existing.status !== 'out_for_delivery') {
        throw new Error(`La orden no está en estado válido para entrega final. Estado actual: ${existing.status}`)
      }

      if (existing.final_delivery_confirmed_at) {
        throw new Error('Esta orden ya fue confirmada para entrega final')
      }

      // Actualizar orden
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data: {
          status: 'delivered',
          delivered_at: new Date(),
          final_delivery_confirmed_at: new Date(),
        },
        include: orderInclude,
      })

      // Actualizar delivery si existe
      const delivery = await tx.delivery.findFirst({
        where: { order_id },
        orderBy: { created_at: 'desc' },
      })

      if (delivery) {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: 'delivered',
            delivered_at: new Date(),
          },
        })
      }

      await createTrackingEntry(order_id, 'out_for_delivery', 'delivered', 'Confirmada entrega final al cliente', existing.profile_id)

      return updatedOrder
    })

    res.json(normalizeBigInts(order))
  } catch (err: any) {
    console.error('Error confirming final delivery:', err)
    if (err.message === 'Orden no encontrada') {
      return res.status(404).json({ message: err.message })
    }
    if (err.message.includes('Código de confirmación inválido') || err.message.includes('ya fue confirmada') || err.message.includes('no está en estado')) {
      return res.status(400).json({ message: err.message })
    }
    res.status(500).json({ message: 'Error al confirmar entrega final' })
  }
}

/**
 * Endpoint auxiliar: Obtener código de confirmación para una orden (solo lectura)
 */
export const getConfirmationCode = async (req: Request, res: Response) => {
  const { id } = req.params // La ruta usa :id
  const { type } = req.query as { type?: 'pickup' | 'plant_received' | 'plant_ready' | 'final_delivery' }

  try {
    // Obtener todos los códigos de confirmación sin condiciones
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        order_number: true,
        status: true,
        pickup_confirmation_code: true,
        plant_received_confirmation_code: true,
        plant_ready_confirmation_code: true,
        final_delivery_confirmation_code: true,
      },
    })

    if (!order) {
      return res.status(404).json({ message: 'Orden no encontrada' })
    }

    // Filtrar según el tipo solicitado si se especifica
    const response: any = {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
    }

    if (type === 'pickup' || !type) {
      response.pickup_confirmation_code = order.pickup_confirmation_code
    }
    if (type === 'plant_received' || !type) {
      response.plant_received_confirmation_code = order.plant_received_confirmation_code
    }
    if (type === 'plant_ready' || !type) {
      response.plant_ready_confirmation_code = order.plant_ready_confirmation_code
    }
    if (type === 'final_delivery' || !type) {
      response.final_delivery_confirmation_code = order.final_delivery_confirmation_code
    }

    res.json(normalizeBigInts(response))
  } catch (err: any) {
    console.error('Error getting confirmation code:', err)
    console.error('Error stack:', err.stack)
    console.error('Request details:', { id, type })
    res.status(500).json({ 
      message: 'Error al obtener código de confirmación',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: err.code,
    })
  }
}
