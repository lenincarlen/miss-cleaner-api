import { prisma } from '../lib/prisma'

async function main() {
  // Ensure module 'orders' exists
  const ordersModule = await prisma.module.upsert({
    where: { key: 'orders' },
    update: {},
    create: {
      key: 'orders',
      name: 'Orders',
      description: 'Gestión de órdenes',
    },
  })

  // Ensure permission 'orders_delivery' exists for the module
  let permission = await prisma.permission.findFirst({
    where: { module_id: ordersModule.id, action: 'orders_delivery' },
  })
  if (!permission) {
    permission = await prisma.permission.create({
      data: {
        module_id: ordersModule.id,
        action: 'orders_delivery',
        description: 'Permite a delivery actualizar estados de órdenes',
      },
    })
  }

  // Ensure role 'delivery' exists
  let deliveryRole = await prisma.role.findUnique({ where: { name: 'delivery' } })
  if (!deliveryRole) {
    deliveryRole = await prisma.role.create({
      data: { name: 'delivery', description: 'Rol para repartidores' },
    })
  }

  // Ensure mapping role_permissions exists
  const existingRP = await prisma.rolePermission.findFirst({
    where: { role_id: deliveryRole.id, permission_id: permission.id },
  })
  if (!existingRP) {
    await prisma.rolePermission.create({
      data: {
        role_id: deliveryRole.id,
        permission_id: permission.id,
      },
    })
  }

  console.log('Permiso orders_delivery asignado al rol delivery.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })


