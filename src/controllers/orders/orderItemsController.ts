import { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

type OrderItemCreateInput = {
  order_id: string
  service_id?: string | null
  description: string
  quantity: number | string
  unit_price: number | string
  notes?: string | null
}

type OrderItemUpdateInput = {
  service_id?: string | null
  description?: string
  quantity?: number | string
  unit_price?: number | string
  notes?: string | null
}

const orderItemInclude = {
  order: {
    select: {
      id: true,
      order_number: true,
      profile: {
        select: { id: true, available_credit: true },
      },
    },
  },
  service: {
    select: {
      id: true,
      name: true,
      price: true,
      currency: {
        select: {
          iso_code: true,
          symbol: true,
        },
      },
    },
  },
} as const

const toInt = (value?: number | string | null) => {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value
  if (Number.isNaN(parsed)) {
    return undefined
  }
  return parsed
}

const toDecimal = (value?: number | string | null) => {
  if (value === undefined) {
    return undefined
  }
  const parsed = typeof value === 'string' ? value.trim() : value
  if (parsed === null || parsed === undefined || parsed === '') {
    return new Prisma.Decimal(0)
  }
  return new Prisma.Decimal(parsed)
}

// Get all order items
export const getOrderItems = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.orderItem.findMany({
      include: orderItemInclude,
    })

    res.json(items)
  } catch (err) {
    console.error('Error fetching order items:', err)
    res.status(500).json({ message: 'Error fetching order items' })
  }
}

// Get order item by ID
export const getOrderItemById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const item = await prisma.orderItem.findUnique({
      where: { id },
      include: orderItemInclude,
    })

    if (!item) {
      return res.status(404).json({ message: 'Order item not found' })
    }

    res.json(item)
  } catch (err) {
    console.error(`Error fetching order item with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching order item' })
  }
}

// Create a new order item
export const createOrderItem = async (req: Request, res: Response) => {
  const { order_id, service_id, description, quantity, unit_price, notes }: OrderItemCreateInput = req.body

  try {
    const parsedQuantity = toInt(quantity)
    const parsedUnitPrice = toDecimal(unit_price)
    const quantityValue = parsedQuantity ?? 0
    const unitPriceValue = parsedUnitPrice ?? new Prisma.Decimal(0)
    const totalPrice = unitPriceValue.mul(quantityValue)

    const item = await prisma.$transaction(async (tx) => {
      // Create item
      const created = await tx.orderItem.create({
        data: {
          order_id,
          service_id: service_id ?? undefined,
          description,
          quantity: quantityValue,
          unit_price: unitPriceValue,
          total_price: totalPrice,
          notes,
        },
        include: orderItemInclude,
      })

      // Update order total and decrement profile credit
      const order = await tx.order.update({
        where: { id: order_id },
        data: { total_amount: { increment: totalPrice } },
        select: { id: true, profile_id: true },
      })

      if (order.profile_id) {
        try {
          const profile = await tx.profile.findUnique({
            where: { id: order.profile_id },
            select: { available_credit: true, monthly_credit_limit: true, payment_mode: true },
          })
          if (profile?.payment_mode === 'self_pay') {
            // No descontar crédito cuando el cliente paga directamente
            return created
          }
          const available = profile?.available_credit
          const limit = profile?.monthly_credit_limit
          const current = available instanceof Prisma.Decimal
            ? available
            : (available != null
              ? new Prisma.Decimal(available as unknown as any)
              : (limit instanceof Prisma.Decimal ? limit : new Prisma.Decimal(limit ?? 0)))
          let next = current.sub(totalPrice)
          if (next.isNegative()) next = new Prisma.Decimal(0)
          await tx.profile.update({ where: { id: order.profile_id }, data: { available_credit: next } })
        } catch (err) {
          console.error('Failed to decrement available_credit on create item', { order_id, err })
        }
      }

      // Re-read the item to include fresh order.profile.available_credit
      const finalItem = await tx.orderItem.findUnique({
        where: { id: created.id },
        include: orderItemInclude,
      })
      return finalItem
    })

    res.status(201).json(item)
  } catch (err: any) {
    console.error('Error creating order item:', err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.status(500).json({ message: 'Error creating order item' })
  }
}

// Update an order item
export const updateOrderItem = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: OrderItemUpdateInput = req.body

  try {
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.orderItem.findUnique({
        where: { id },
        select: { id: true, order_id: true, total_price: true },
      })
      if (!existing) throw new Error('Order item not found')

      const parsedQuantity = toInt(data.quantity)
      const parsedUnitPrice = toDecimal(data.unit_price)
      const shouldRecalculateTotal = parsedQuantity !== undefined || parsedUnitPrice !== undefined
      const quantityValue = parsedQuantity ?? undefined
      const unitPriceValue = parsedUnitPrice
      const newTotal = shouldRecalculateTotal
        ? (unitPriceValue ?? new Prisma.Decimal(0)).mul(parsedQuantity ?? 0)
        : undefined

      const updated = await tx.orderItem.update({
        where: { id },
        data: {
          service_id: data.service_id ?? undefined,
          description: data.description ?? undefined,
          quantity: quantityValue,
          unit_price: unitPriceValue,
          total_price: newTotal,
          notes: data.notes ?? undefined,
        },
        include: orderItemInclude,
      })

      if (shouldRecalculateTotal) {
        const oldTotal = existing.total_price instanceof Prisma.Decimal
          ? existing.total_price
          : new Prisma.Decimal(existing.total_price ?? 0)
        const newTotalDec = newTotal ?? oldTotal
        const delta = newTotalDec.sub(oldTotal) // positive = more consumption
        const order = await tx.order.update({
          where: { id: existing.order_id },
          data: { total_amount: { increment: delta } },
          select: { profile_id: true },
        })
        if (order.profile_id) {
          try {
            const profile = await tx.profile.findUnique({
              where: { id: order.profile_id },
              select: { available_credit: true, monthly_credit_limit: true, payment_mode: true },
            })
            if (profile?.payment_mode === 'self_pay') {
              return updated
            }
            const available = profile?.available_credit
            const limit = profile?.monthly_credit_limit
            const current = available instanceof Prisma.Decimal
              ? available
              : (available != null
                ? new Prisma.Decimal(available as unknown as any)
                : (limit instanceof Prisma.Decimal ? limit : new Prisma.Decimal(limit ?? 0)))
            let next = current.sub(delta) // if delta negative, this adds back
            if (next.isNegative()) next = new Prisma.Decimal(0)
            await tx.profile.update({ where: { id: order.profile_id }, data: { available_credit: next } })
          } catch (err) {
            console.error('Failed to adjust available_credit on update item', { id, err })
          }
        }
      }

      // Re-read the item to include fresh order.profile.available_credit
      const finalItem = await tx.orderItem.findUnique({ where: { id }, include: orderItemInclude })
      return finalItem
    })

    res.json(item)
  } catch (err: any) {
    console.error(`Error updating order item with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Order item not found' })
    }
    res.status(500).json({ message: 'Error updating order item' })
  }
}

// Delete an order item
export const deleteOrderItem = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.orderItem.findUnique({
        where: { id },
        select: { id: true, order_id: true, total_price: true },
      })
      if (!existing) return

      await tx.orderItem.delete({ where: { id } })

      const oldTotal = existing.total_price instanceof Prisma.Decimal
        ? existing.total_price
        : new Prisma.Decimal(existing.total_price ?? 0)
      const order = await tx.order.update({
        where: { id: existing.order_id },
        data: { total_amount: { decrement: oldTotal } },
        select: { id: true, profile_id: true },
      })

      if (order.profile_id) {
        try {
          const profile = await tx.profile.findUnique({
            where: { id: order.profile_id },
            select: { available_credit: true, monthly_credit_limit: true, payment_mode: true },
          })
          if (profile?.payment_mode === 'self_pay') {
            return
          }
          const available = profile?.available_credit
          const limit = profile?.monthly_credit_limit
          const current = available instanceof Prisma.Decimal
            ? available
            : (available != null
              ? new Prisma.Decimal(available as unknown as any)
              : (limit instanceof Prisma.Decimal ? limit : new Prisma.Decimal(limit ?? 0)))
          const next = current.add(oldTotal)
          await tx.profile.update({ where: { id: order.profile_id }, data: { available_credit: next } })
        } catch (err) {
          console.error('Failed to restore available_credit on delete item', { id, err })
        }
      }

      const orderWithProfile = await tx.order.findUnique({
        where: { id: existing.order_id },
        select: { id: true, profile: { select: { id: true, available_credit: true } } },
      })

      return { order: orderWithProfile }
    })
    res.status(200).json(result)
  } catch (err: any) {
    console.error(`Error deleting order item with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Order item not found' })
    }
    res.status(500).json({ message: 'Error deleting order item' })
  }
}
