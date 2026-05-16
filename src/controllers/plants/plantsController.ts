import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'

type PlantCreateInput = {
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  zone_id?: string | null
  daily_capacity?: number | null
  status?: 'active' | 'inactive' | 'pending' | null
  manager_user_id?: string | null
  operational_hours?: any
  service_types?: string[] | null
  service_ids?: string[] | null
  is_active?: boolean | null
}

type PlantUpdateInput = Partial<PlantCreateInput>

export const getPlants = async (_req: Request, res: Response) => {
  try {
    const plants = await prisma.plant.findMany({
      orderBy: { created_at: 'desc' },
    })
    res.json(plants)
  } catch (err) {
    console.error('Error fetching plants:', err)
    res.status(500).json({ message: 'Error fetching plants' })
  }
}

export const createPlant = async (req: Request, res: Response) => {
  const { name, address, phone, email, zone_id, daily_capacity, status, manager_user_id, operational_hours, service_types, service_ids, is_active }: PlantCreateInput = req.body
  try {
    const plant = await prisma.plant.create({
      data: {
        name,
        address: address ?? undefined,
        phone: phone ?? undefined,
        email: email ?? undefined,
        zone_id: zone_id ?? undefined,
        daily_capacity: typeof daily_capacity === 'number' ? daily_capacity : undefined,
        status: status ?? undefined,
        manager_user_id: manager_user_id ?? undefined,
        operational_hours: operational_hours ?? undefined,
        service_types: Array.isArray(service_types) ? service_types : undefined,
        services: Array.isArray(service_ids) && service_ids.length > 0
          ? { connect: service_ids.map((id: string) => ({ id })) }
          : undefined,
        is_active: typeof is_active === 'boolean' ? is_active : undefined,
      },
    })
    res.status(201).json(plant)
  } catch (err) {
    console.error('Error creating plant:', err)
    res.status(500).json({ message: 'Error creating plant' })
  }
}

export const getPlantById = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const plant = await prisma.plant.findUnique({
      where: { id },
    })
    if (!plant) return res.status(404).json({ message: 'Plant not found' })
    res.json(plant)
  } catch (err) {
    console.error('Error fetching plant by id:', err)
    res.status(500).json({ message: 'Error fetching plant' })
  }
}

export const updatePlant = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: PlantUpdateInput = req.body
  try {
    const updateData: any = {}
    
    if (data.name !== undefined) updateData.name = data.name
    if (data.address !== undefined) updateData.address = data.address ?? null
    if (data.phone !== undefined) updateData.phone = data.phone ?? null
    if (data.email !== undefined) updateData.email = data.email ?? null
    if (data.zone_id !== undefined) updateData.zone_id = data.zone_id || null // Permitir null explícitamente
    if (data.daily_capacity !== undefined) updateData.daily_capacity = typeof data.daily_capacity === 'number' ? data.daily_capacity : null
    if (data.status !== undefined) updateData.status = data.status
    if (data.manager_user_id !== undefined) updateData.manager_user_id = data.manager_user_id ?? null
    if (data.operational_hours !== undefined) updateData.operational_hours = data.operational_hours
    if (Array.isArray(data.service_types)) updateData.service_types = data.service_types
    if (Array.isArray((data as any).service_ids)) {
      updateData.services = { set: (data as any).service_ids.map((sid: string) => ({ id: sid })) }
    }
    if (typeof data.is_active === 'boolean') updateData.is_active = data.is_active

    const plant = await prisma.plant.update({
      where: { id },
      data: updateData,
    })
    res.json(plant)
  } catch (err: any) {
    console.error('Error updating plant:', err)
    if (err.code === 'P2025') return res.status(404).json({ message: 'Plant not found' })
    if (err.code === 'P2003') return res.status(400).json({ message: 'Invalid zone_id reference' })
    res.status(500).json({ message: 'Error updating plant', error: err.message })
  }
}

export const createPlantOperator = async (req: Request, res: Response) => {
  const { plant_id } = req.params
  const { first_name, last_name, email, password } = req.body as {
    first_name: string
    last_name: string
    email: string
    password: string
  }

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios' })
  }

  if (!plant_id) {
    return res.status(400).json({ message: 'plant_id es obligatorio' })
  }

  try {
    // Verificar que la planta existe
    const plant = await prisma.plant.findUnique({
      where: { id: plant_id },
    })

    if (!plant) {
      return res.status(404).json({ message: 'Planta no encontrada' })
    }

    // Buscar el rol "planta"
    const role = await prisma.role.findUnique({
      where: { name: 'planta' },
    })

    if (!role) {
      return res.status(500).json({ message: 'Rol "planta" no encontrado en el sistema' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const full_name = `${first_name} ${last_name}`.trim()

    const result = await prisma.$transaction(async (tx: any) => {
      // Crear usuario
      const user = await tx.user.create({
        data: {
          email,
          password_hash: hashedPassword,
          role_id: role.id,
          is_active: true,
        },
      })

      // Asignar rol en UserRole
      await tx.userRole.create({
        data: {
          user_id: user.id,
          role_id: role.id,
        },
      })

      // Crear perfil asociado a la planta
      const profile = await tx.profile.create({
        data: {
          user_id: user.id,
          full_name,
          plant_id,
        },
        include: {
          user: {
            include: {
              role: true,
            },
          },
          plant: true,
        },
      })

      return profile
    })

    res.status(201).json(result)
  } catch (err: any) {
    console.error('Error creating plant operator:', err)
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'El email ya está en uso' })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Planta no encontrada' })
    }
    res.status(500).json({ message: 'Error al crear operador de planta' })
  }
}


