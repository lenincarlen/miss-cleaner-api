import { Request, Response } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../../lib/prisma'
import { normalizeBigInts } from '../../utils/serialization'

type ServiceCreateInput = {
  name: string
  description?: string | null

  currency_id?: string | null
  category_id?: string | null
  is_active?: boolean
  tag_ids?: string[]
  variants?: Array<{ name: string; price: number | string; icon_name?: string | null }>
}

type ServiceUpdateInput = Partial<ServiceCreateInput>

const baseServiceInclude = {
  // tags eliminados
  variants: true,
  banner_file: {
    select: {
      id: true,
      original_name: true,
      storage_path: true,
      mime_type: true,
      file_size: true,
      created_at: true,
    },
  },
}

// Sin precio base: todas las tarifas viven en variants

const normalizeBoolean = (value?: boolean | string | null) => {
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'string') {
    return value === 'true'
  }
  return undefined
}

export const getServices = async (_req: Request, res: Response) => {
  try {
    const services = await prisma.service.findMany({
      include: baseServiceInclude as any,
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(normalizeBigInts(services))
  } catch (err) {
    console.error('Error fetching services:', err)
    const anyErr: any = err
    res.status(500).json({ message: 'Error fetching services', code: anyErr?.code ?? undefined, error: anyErr?.message ?? String(anyErr) })
  }
}

export const getServiceById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const service = await prisma.service.findUnique({
      where: { id },
      include: baseServiceInclude as any,
    })

    if (!service) {
      return res.status(404).json({ message: 'Service not found' })
    }

    res.json(normalizeBigInts(service))
  } catch (err) {
    console.error(`Error fetching service with id ${id}:`, err)
    const anyErr: any = err
    res.status(500).json({ message: 'Error fetching service', code: anyErr?.code ?? undefined, error: anyErr?.message ?? String(anyErr) })
  }
}

// upsertServiceTags eliminado

export const createService = async (req: Request, res: Response) => {
  const body = req.body as any
  // Support multipart/form-data where arrays may arrive as strings
  const name = body.name as string
  const description = (body.description as string | undefined) ?? null
  
  const currency_id = null
  const category_id = null
  const is_active = body.is_active as any
  // tags eliminados
  const variantsRaw = body.variants
  const variants: Array<{ name: string; price: number | string; icon_name?: string | null }> | undefined =
    typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw
  const banner_url: string | undefined = body.banner_url

  try {
    

    const service = await prisma.$transaction(async (tx: any) => {
      const created = await tx.service.create({
        data: {
          name,
          description: description ?? null,
        
          is_active: normalizeBoolean(is_active) ?? true,
        },
      })

      // tags eliminados

      if (variants && variants.length > 0) {
        await tx.serviceVariant.createMany({
          data: variants.map((v) => ({
            service_id: created.id,
            name: v.name,
            price: Number(v.price ?? 0),
            icon_name: v.icon_name ?? null,
          })),
          skipDuplicates: true,
        })
      }

      // Handle banner file if uploaded
      let bannerFileId = await buildBannerFile((req as any).file)
      if (!bannerFileId && typeof banner_url === 'string' && banner_url.trim()) {
        bannerFileId = await buildBannerFileFromUrl(banner_url.trim())
      }
      if (bannerFileId) {
        await tx.service.update({
          where: { id: created.id },
          data: { banner_file_id: bannerFileId },
        })
      }

      return tx.service.findUniqueOrThrow({
        where: { id: created.id },
        include: baseServiceInclude as any,
      })
    })

    res.status(201).json(normalizeBigInts(service))
  } catch (err) {
    console.error('Error creating service:', err)
    const anyErr: any = err
    res.status(500).json({
      message: 'Error creating service',
      code: anyErr?.code ?? undefined,
      error: anyErr?.message ?? String(anyErr),
    })
  }
}

export const updateService = async (req: Request, res: Response) => {
  const { id } = req.params
  const body = req.body as any
  const data: ServiceUpdateInput = body
  const variantsRaw = body.variants as any
  const variants: Array<{ name: string; price: number | string; icon_name?: string | null }> | undefined =
    typeof variantsRaw === 'string' ? JSON.parse(variantsRaw) : variantsRaw
  const banner_file_action: 'replace' | 'remove' | undefined = body.banner_file_action
  const banner_url: string | undefined = body.banner_url

  try {
    // ya no aceptamos price en Service, solo en variants
    const numericPrice = undefined

    const service = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.service.update({
        where: { id },
        data: {
          name: data.name ?? undefined,
          description: data.description ?? undefined,
          
          is_active: normalizeBoolean(data.is_active),
        },
      })

      // tags eliminados

      if (Array.isArray(variants)) {
        await tx.serviceVariant.deleteMany({ where: { service_id: id } })
        if (variants.length) {
          await tx.serviceVariant.createMany({
            data: variants.map((v) => ({
              service_id: id,
              name: v.name,
              price: Number(v.price ?? 0),
              icon_name: v.icon_name ?? null,
            })),
            skipDuplicates: true,
          })
        }
      }

      // Handle banner file changes
      if ((req as any).file) {
        const bannerId = await buildBannerFile((req as any).file)
        if (bannerId) {
          await tx.service.update({ where: { id }, data: { banner_file_id: bannerId } })
        }
      } else if (typeof banner_url === 'string' && banner_url.trim()) {
        const bannerId = await buildBannerFileFromUrl(banner_url.trim())
        if (bannerId) {
          await tx.service.update({ where: { id }, data: { banner_file_id: bannerId } })
        }
      } else if (banner_file_action === 'remove') {
        await tx.service.update({ where: { id }, data: { banner_file_id: null } })
      }

      return tx.service.findUniqueOrThrow({
        where: { id: updated.id },
        include: baseServiceInclude as any,
      })
    })

    res.json(normalizeBigInts(service))
  } catch (err: any) {
    console.error(`Error updating service with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Service not found' })
    }
    res.status(500).json({ message: 'Error updating service', code: err?.code ?? undefined, error: err?.message ?? String(err) })
  }
}

export const deleteService = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.service.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting service with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Service not found' })
    }
    res.status(500).json({ message: 'Error deleting service' })
  }
}

export const getServiceMetadata = async (_req: Request, res: Response) => {
  try {
    const [categories, currencies] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.currency.findMany({
        select: { id: true, iso_code: true, symbol: true },
        orderBy: { iso_code: 'asc' },
      }),
    ])

    res.json({ categories, currencies, tags: [] })
  } catch (err) {
    console.error('Error fetching service metadata:', err)
    res.status(500).json({ message: 'Error fetching service metadata' })
  }
}

// ======= File upload (banner) setup =======
const servicesDir = path.join(process.cwd(), 'uploads', 'services')
const ensureServicesDir = async () => {
  try {
    await fs.mkdir(servicesDir, { recursive: true })
  } catch (err) {
    console.error('Failed to ensure services directory', err)
  }
}
ensureServicesDir()

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, servicesDir)
  },
  filename(_req, file, cb) {
    const sanitized = file.originalname.replace(/\s+/g, '_')
    cb(null, `${Date.now()}-${sanitized}`)
  },
})

export const serviceBannerUpload = multer({ storage })

const buildBannerFile = async (file?: Express.Multer.File | null) => {
  if (!file) return undefined
  const relativePath = path.relative(process.cwd(), file.path)
  const created = await prisma.file.create({
    data: {
      storage_path: relativePath,
      original_name: file.originalname,
      mime_type: file.mimetype,
      file_size: BigInt(file.size),
      checksum: null,
    },
  })
  return created.id
}

// Registra una referencia a una URL externa como File (sin descargarla)
const buildBannerFileFromUrl = async (url: string) => {
  try {
    const created = await prisma.file.create({
      data: {
        storage_path: url, // Puede ser absoluta (https://...)
        original_name: url.split('/').pop() || 'remote',
        mime_type: null,
        file_size: null,
        checksum: null,
      },
    })
    return created.id
  } catch (err) {
    console.error('Failed to register banner URL', { url, err })
    return undefined
  }
}
