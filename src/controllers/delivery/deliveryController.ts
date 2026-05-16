import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

const DELIVERY_STATUS = {
  pending: 'pending',
  assigned: 'assigned',
  inTransit: 'in_transit',
  atPlant: 'at_plant',
  delivered: 'delivered',
  rejected: 'rejected',
} as const

const ORDER_STATUS_FROM_DELIVERY: Record<string, string> = {
  [DELIVERY_STATUS.pending]: 'pending_pickup',
  [DELIVERY_STATUS.assigned]: 'pending_pickup',
  [DELIVERY_STATUS.inTransit]: 'in_transit',
  [DELIVERY_STATUS.atPlant]: 'processing',
  [DELIVERY_STATUS.delivered]: 'delivered',
  [DELIVERY_STATUS.rejected]: 'pending_pickup',
}

const createTrackingEntry = async (
  orderId: string,
  fromStatus: string,
  toStatus: string,
  notes?: string | null,
  changedByProfileId?: string | null
) => {
  await prisma.orderTracking.create({
    data: {
      order_id: orderId,
      status_from: fromStatus,
      status_to: toStatus,
      notes: notes ?? undefined,
      changed_by_profile_id: changedByProfileId ?? undefined,
    },
  })
}

const updateOrderStatus = async (
  orderId: string,
  currentStatus: string,
  nextStatus: string,
  notes?: string | null,
  changedByProfileId?: string | null
) => {
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: nextStatus,
      delivered_at: nextStatus === 'delivered' ? new Date() : undefined,
    },
  })

  await createTrackingEntry(orderId, currentStatus, nextStatus, notes, changedByProfileId)

  return updatedOrder
}

type DeliveryCreateInput = {
  order_id: string
  pickup_profile_id?: string | null
  delivery_profile_id?: string | null
  assigned_by_user_id?: string | null
  pickup_address?: string | null
  delivery_address?: string | null
  scheduled_pickup_date?: string | null
  scheduled_delivery_date?: string | null
  status?: string | null
  notes?: string | null
  pickup_confirmation_code?: string | null
  delivery_confirmation_code?: string | null
  assigned_at?: string | null
  accepted_at?: string | null
  delivered_at?: string | null
  rejection_reason?: string | null
}

type DeliveryUpdateInput = Partial<DeliveryCreateInput>

const includeConfig = {
  pickup_profile: {
    select: {
      id: true,
      full_name: true,
    },
  },
  delivery_profile: {
    select: {
      id: true,
      full_name: true,
    },
  },
  accepted_by_profile: {
    select: {
      id: true,
      full_name: true,
    },
  },
  assigned_by_user: {
    select: {
      id: true,
      email: true,
    },
  },
  order: {
    select: {
      id: true,
      order_number: true,
      status: true,
      total_amount: true,
      profile: {
        select: {
          id: true,
          full_name: true,
        },
      },
    },
  },
} as const

const toDateTime = (value?: string | null) => {
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

// Get all deliveries
export const getDeliveries = async (req: Request, res: Response) => {
  try {
    const { delivery_profile_id, accepted_by_profile_id, pickup_profile_id, status, order_id } = req.query as {
      delivery_profile_id?: string
      accepted_by_profile_id?: string
      pickup_profile_id?: string
      status?: string
      order_id?: string
    }

    const where: any = {}
    if (delivery_profile_id) where.delivery_profile_id = delivery_profile_id
    if (accepted_by_profile_id) where.accepted_by_profile_id = accepted_by_profile_id
    if (pickup_profile_id) where.pickup_profile_id = pickup_profile_id
    if (status) where.status = status
    if (order_id) where.order_id = order_id

    const deliveries = await prisma.delivery.findMany({
      where,
      include: includeConfig,
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(deliveries)
  } catch (err) {
    console.error('Error fetching deliveries:', err)
    res.status(500).json({ message: 'Error fetching deliveries' })
  }
}

// Get delivery by ID
export const getDeliveryById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: includeConfig,
    })

    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' })
    }

    res.json(delivery)
  } catch (err) {
    console.error(`Error fetching delivery with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching delivery' })
  }
}

// Create a new delivery
export const createDelivery = async (req: Request, res: Response) => {
  const {
    order_id,
    pickup_profile_id,
    delivery_profile_id,
    assigned_by_user_id,
    pickup_address,
    delivery_address,
    scheduled_pickup_date,
    scheduled_delivery_date,
    status,
    notes,
    pickup_confirmation_code,
    delivery_confirmation_code,
    assigned_at,
    accepted_at,
    delivered_at,
    rejection_reason,
  }: DeliveryCreateInput = req.body

  try {
    const delivery = await prisma.delivery.create({
      data: {
        order_id,
        pickup_profile_id: pickup_profile_id ?? undefined,
        delivery_profile_id: delivery_profile_id ?? undefined,
        assigned_by_user_id: assigned_by_user_id ?? undefined,
        pickup_address: pickup_address ?? undefined,
        delivery_address: delivery_address ?? undefined,
        scheduled_pickup_date: toDateTime(scheduled_pickup_date),
        scheduled_delivery_date: toDateTime(scheduled_delivery_date),
        status: status ?? undefined,
        notes: notes ?? undefined,
        pickup_confirmation_code: pickup_confirmation_code ?? undefined,
        delivery_confirmation_code: delivery_confirmation_code ?? undefined,
        assigned_at: toDateTime(assigned_at),
        accepted_at: toDateTime(accepted_at),
        delivered_at: toDateTime(delivered_at),
        rejection_reason: rejection_reason ?? undefined,
      },
      include: includeConfig,
    })

    res.status(201).json(delivery)
  } catch (err) {
    console.error('Error creating delivery:', err)
    res.status(500).json({ message: 'Error creating delivery' })
  }
}

// Update a delivery
export const updateDelivery = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: DeliveryUpdateInput = req.body

  try {
    const delivery = await prisma.delivery.update({
      where: { id },
      data: {
        pickup_profile_id: data.pickup_profile_id ?? undefined,
        delivery_profile_id: data.delivery_profile_id ?? undefined,
        assigned_by_user_id: data.assigned_by_user_id ?? undefined,
        pickup_address: data.pickup_address ?? undefined,
        delivery_address: data.delivery_address ?? undefined,
        scheduled_pickup_date: toDateTime(data.scheduled_pickup_date),
        scheduled_delivery_date: toDateTime(data.scheduled_delivery_date),
        status: data.status ?? undefined,
        notes: data.notes ?? undefined,
        pickup_confirmation_code: data.pickup_confirmation_code ?? undefined,
        delivery_confirmation_code: data.delivery_confirmation_code ?? undefined,
        assigned_at: toDateTime(data.assigned_at),
        accepted_at: toDateTime(data.accepted_at),
        delivered_at: toDateTime(data.delivered_at),
        rejection_reason: data.rejection_reason ?? undefined,
      },
      include: includeConfig,
    })

    res.json(delivery)
  } catch (err: any) {
    console.error(`Error updating delivery with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error updating delivery' })
  }
}

// Delete a delivery
export const deleteDelivery = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.delivery.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting delivery with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error deleting delivery' })
  }
}

export const assignDelivery = async (req: Request, res: Response) => {
  const { id } = req.params
  const {
    delivery_profile_id,
    pickup_profile_id,
    assigned_by_user_id,
    scheduled_pickup_date,
    scheduled_delivery_date,
    pickup_confirmation_code,
    notes,
  } = req.body as {
    delivery_profile_id?: string | null
    pickup_profile_id?: string | null
    assigned_by_user_id?: string | null
    scheduled_pickup_date?: string | null
    scheduled_delivery_date?: string | null
    pickup_confirmation_code?: string | null
    notes?: string | null
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: {
          order: true,
        },
      })

      if (!existing) {
        throw new Error('Delivery not found')
      }

      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          delivery_profile_id: delivery_profile_id ?? undefined,
          pickup_profile_id: pickup_profile_id ?? undefined,
          assigned_by_user_id: assigned_by_user_id ?? undefined,
          assigned_at: new Date(),
          scheduled_pickup_date: toDateTime(scheduled_pickup_date),
          scheduled_delivery_date: toDateTime(scheduled_delivery_date),
          pickup_confirmation_code: pickup_confirmation_code ?? undefined,
          status: DELIVERY_STATUS.assigned,
          notes: notes ?? undefined,
        },
        include: includeConfig,
      })

      await tx.order.update({
        where: { id: existing.order_id },
        data: {
          status: ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.assigned],
        },
      })

      await createTrackingEntry(
        existing.order_id,
        existing.order.status,
        ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.assigned],
        notes,
        delivery_profile_id ?? existing.delivery_profile_id ?? null
      )

      return updatedDelivery
    })

    res.json(result)
  } catch (err: any) {
    console.error(`Error assigning delivery ${id}:`, err)
    if (err.message === 'Delivery not found') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error assigning delivery' })
  }
}

export const acceptDelivery = async (req: Request, res: Response) => {
  const { id } = req.params
  const { accepted_by_profile_id, notes } = req.body as {
    accepted_by_profile_id?: string | null
    notes?: string | null
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: {
          order: true,
        },
      })

      if (!existing) {
        throw new Error('Delivery not found')
      }

      const courierProfile = accepted_by_profile_id ?? existing.delivery_profile_id ?? null

      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          accepted_by_profile_id: courierProfile ?? undefined,
          accepted_at: new Date(),
          status: DELIVERY_STATUS.inTransit,
          notes: notes ?? undefined,
        },
        include: includeConfig,
      })

      await tx.order.update({
        where: { id: existing.order_id },
        data: {
          status: ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.inTransit],
        },
      })

      await createTrackingEntry(
        existing.order_id,
        existing.order.status,
        ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.inTransit],
        notes,
        courierProfile
      )

      return updatedDelivery
    })

    res.json(result)
  } catch (err: any) {
    console.error(`Error accepting delivery ${id}:`, err)
    if (err.message === 'Delivery not found') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error accepting delivery' })
  }
}

export const completeDelivery = async (req: Request, res: Response) => {
  const { id } = req.params
  const { delivery_confirmation_code, notes } = req.body as {
    delivery_confirmation_code?: string | null
    notes?: string | null
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: {
          order: true,
        },
      })

      if (!existing) {
        throw new Error('Delivery not found')
      }

      const completedAt = new Date()

      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          delivery_confirmation_code: delivery_confirmation_code ?? undefined,
          delivered_at: completedAt,
          status: DELIVERY_STATUS.delivered,
          notes: notes ?? undefined,
        },
        include: includeConfig,
      })

      await tx.order.update({
        where: { id: existing.order_id },
        data: {
          status: ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.delivered],
          delivered_at: completedAt,
        },
      })

      await createTrackingEntry(
        existing.order_id,
        existing.order.status,
        ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.delivered],
        notes,
        existing.delivery_profile_id ?? null
      )

      return updatedDelivery
    })

    res.json(result)
  } catch (err: any) {
    console.error(`Error completing delivery ${id}:`, err)
    if (err.message === 'Delivery not found') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error completing delivery' })
  }
}

export const rejectDelivery = async (req: Request, res: Response) => {
  const { id } = req.params
  const { rejection_reason, notes } = req.body as {
    rejection_reason?: string | null
    notes?: string | null
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.delivery.findUnique({
        where: { id },
        include: {
          order: true,
        },
      })

      if (!existing) {
        throw new Error('Delivery not found')
      }

      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: {
          status: DELIVERY_STATUS.rejected,
          rejection_reason: rejection_reason ?? undefined,
          notes: notes ?? undefined,
          delivery_profile_id: null,
          accepted_by_profile_id: null,
        },
        include: includeConfig,
      })

      await tx.order.update({
        where: { id: existing.order_id },
        data: {
          status: ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.rejected],
        },
      })

      await createTrackingEntry(
        existing.order_id,
        existing.order.status,
        ORDER_STATUS_FROM_DELIVERY[DELIVERY_STATUS.rejected],
        rejection_reason ?? notes,
        null
      )

      return updatedDelivery
    })

    res.json(result)
  } catch (err: any) {
    console.error(`Error rejecting delivery ${id}:`, err)
    if (err.message === 'Delivery not found') {
      return res.status(404).json({ message: 'Delivery not found' })
    }
    res.status(500).json({ message: 'Error rejecting delivery' })
  }
}
