import { prisma } from './prisma'

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send'

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Esperando pago',
  pending_pickup: 'Pendiente de recogida',
  in_transit: 'En transito',
  at_plant: 'En planta',
  processing: 'En proceso',
  ready_for_delivery: 'Lista para entrega',
  ready_for_pickup_by_delivery: 'Lista para recoger',
  out_for_delivery: 'En reparto',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
}

function isExpoPushToken(token?: string | null): token is string {
  if (!token) return false
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')
}

function getStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

function buildNotificationContent(orderNumber: string, status: string) {
  const statusLabel = getStatusLabel(status)
  const title = `Orden #${orderNumber} actualizada`
  const body = `Tu orden ahora esta en estado "${statusLabel}".`

  return { title, body, statusLabel }
}

export async function sendOrderStatusPush(orderId: string, status: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        order_number: true,
        profile_id: true,
        profile: {
          select: {
            id: true,
            user_id: true,
            expo_push_token: true,
          },
        },
      },
    })

    if (!order?.profile?.id) {
      return
    }

    const orderNumber = order.order_number || order.id.slice(0, 8)
    const { title, body, statusLabel } = buildNotificationContent(orderNumber, status)

    await prisma.notification.create({
      data: {
        type: 'order_status_changed',
        title,
        message: body,
        user_id: order.profile.user_id,
        profile_id: order.profile.id,
        data: {
          order_id: order.id,
          order_number: order.order_number,
          status,
          status_label: statusLabel,
          screen: 'orders',
        },
      },
    })

    if (!isExpoPushToken(order.profile.expo_push_token)) {
      return
    }

    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: order.profile.expo_push_token,
        title,
        body,
        sound: 'default',
        channelId: 'order-status',
        data: {
          orderId: order.id,
          status,
          statusLabel,
          screen: 'orders',
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Expo push request failed:', errorText)
      return
    }

    const result = (await response.json()) as {
      data?: { status?: string; details?: { error?: string } } | Array<{ status?: string; details?: { error?: string } }>
    }

    const ticket = Array.isArray(result.data) ? result.data[0] : result.data

    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await prisma.profile.update({
        where: { id: order.profile.id },
        data: { expo_push_token: null },
      })
    }
  } catch (error) {
    console.error('Failed to send order status push notification:', error)
  }
}
