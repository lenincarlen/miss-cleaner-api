import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

type ZoneCreateInput = {
  name: string
  description?: string | null
  city?: string | null
  postal_code?: string | null
  geolocation?: any
}

type ZoneUpdateInput = Partial<ZoneCreateInput>

export const getZones = async (_req: Request, res: Response) => {
  try {
    const zones = await prisma.zone.findMany({ orderBy: { created_at: 'desc' } })
    res.json(zones)
  } catch (err) {
    console.error('Error fetching zones:', err)
    res.status(500).json({ message: 'Error fetching zones' })
  }
}

export const getZoneById = async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const zone = await prisma.zone.findUnique({ where: { id } })
    if (!zone) return res.status(404).json({ message: 'Zone not found' })
    res.json(zone)
  } catch (err) {
    console.error('Error fetching zone by id:', err)
    res.status(500).json({ message: 'Error fetching zone' })
  }
}

export const createZone = async (req: Request, res: Response) => {
  const { name, description, city, postal_code, geolocation }: ZoneCreateInput = req.body
  try {
    const zone = await prisma.zone.create({
      data: {
        name,
        description: description ?? undefined,
        city: city ?? undefined,
        postal_code: postal_code ?? undefined,
        geolocation: geolocation ?? undefined,
      },
    })
    res.status(201).json(zone)
  } catch (err) {
    console.error('Error creating zone:', err)
    res.status(500).json({ message: 'Error creating zone' })
  }
}

export const updateZone = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: ZoneUpdateInput = req.body
  try {
    const zone = await prisma.zone.update({
      where: { id },
      data: {
        name: data.name ?? undefined,
        description: data.description ?? undefined,
        city: data.city ?? undefined,
        postal_code: data.postal_code ?? undefined,
        geolocation: data.geolocation ?? undefined,
      },
    })
    res.json(zone)
  } catch (err: any) {
    console.error('Error updating zone:', err)
    if (err.code === 'P2025') return res.status(404).json({ message: 'Zone not found' })
    res.status(500).json({ message: 'Error updating zone' })
  }
}


