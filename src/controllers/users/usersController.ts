import { Request, Response } from 'express'

import { prisma } from '../../lib/prisma'

const userInclude = {
  role: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  user_roles: {
    select: {
      id: true,
      assigned_at: true,
      role: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
    },
  },
} as const

const roleInclude = {
  role_permissions: {
    select: {
      id: true,
      granted_at: true,
      permission: {
        select: {
          id: true,
          action: true,
          description: true,
          module: {
            select: {
              id: true,
              key: true,
              name: true,
            },
          },
        },
      },
    },
  },
} as const

export const getUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: userInclude,
      orderBy: { created_at: 'desc' },
    })

    res.json(users)
  } catch (err) {
    console.error('Error fetching users:', err)
    res.status(500).json({ message: 'Error fetching users' })
  }
}

export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: userInclude,
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  } catch (err) {
    console.error(`Error fetching user ${id}:`, err)
    res.status(500).json({ message: 'Error fetching user' })
  }
}

export const createUser = async (req: Request, res: Response) => {
  const {
    email,
    password_hash,
    role_id,
    is_active,
    additional_role_ids,
  } = req.body as {
    email?: string
    password_hash?: string
    role_id?: string | null
    is_active?: boolean
    additional_role_ids?: string[]
  }

  if (!email) {
    return res.status(400).json({ message: 'El email es obligatorio.' })
  }

  if (!password_hash) {
    return res.status(400).json({ message: 'La contraseña es obligatoria.' })
  }

  try {
    const user = await prisma.$transaction(async (tx: any) => {
      const created = await tx.user.create({
        data: {
          email,
          password_hash,
          role_id: role_id ?? undefined,
          is_active: is_active ?? true,
        },
      })

      const rolesToAssign = new Set<string>()
      if (role_id) {
        rolesToAssign.add(role_id)
      }
      if (Array.isArray(additional_role_ids)) {
        additional_role_ids.filter(Boolean).forEach((roleId) => rolesToAssign.add(roleId))
      }

      if (rolesToAssign.size > 0) {
        await tx.userRole.createMany({
          data: Array.from(rolesToAssign).map((roleId) => ({
            user_id: created.id,
            role_id: roleId,
          })),
          skipDuplicates: true,
        })
      }

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: userInclude,
      })
    })

    res.status(201).json(user)
  } catch (err: any) {
    console.error('Error creating user:', err)
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Email already in use' })
    }
    res.status(500).json({ message: 'Error creating user' })
  }
}

export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params
  const {
    email,
    password_hash,
    role_id,
    is_active,
    additional_role_ids,
  } = req.body as {
    email?: string
    password_hash?: string
    role_id?: string | null
    is_active?: boolean
    additional_role_ids?: string[]
  }

  try {
    const user = await prisma.$transaction(async (tx: any) => {
      const updateData: Record<string, unknown> = {}

      if (email !== undefined) {
        updateData.email = email
      }

      if (password_hash) {
        updateData.password_hash = password_hash
      }

      if (role_id !== undefined) {
        updateData.role_id = role_id
      }

      if (typeof is_active === 'boolean') {
        updateData.is_active = is_active
      }

      const updated = await tx.user.update({
        where: { id },
        data: updateData,
      })

      const hasAdditionalRoles = Array.isArray(additional_role_ids)
      const rolesToAssign = new Set<string>()
      if (role_id) {
        rolesToAssign.add(role_id)
      }
      if (hasAdditionalRoles) {
        additional_role_ids!.filter(Boolean).forEach((roleId) => rolesToAssign.add(roleId))
      }

      if (hasAdditionalRoles || role_id) {
        await tx.userRole.deleteMany({ where: { user_id: id } })

        if (rolesToAssign.size > 0) {
          await tx.userRole.createMany({
            data: Array.from(rolesToAssign).map((roleId) => ({ user_id: id, role_id: roleId })),
            skipDuplicates: true,
          })
        }
      }

      if (!hasAdditionalRoles && role_id) {
        await tx.userRole.createMany({
          data: [{ user_id: id, role_id }],
          skipDuplicates: true,
        })
      }

      return tx.user.findUniqueOrThrow({
        where: { id: updated.id },
        include: userInclude,
      })
    })

    res.json(user)
  } catch (err: any) {
    console.error(`Error updating user ${id}:`, err)
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Email already in use' })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'User not found' })
    }
    res.status(500).json({ message: 'Error updating user' })
  }
}

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.user.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting user ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'User not found' })
    }
    res.status(500).json({ message: 'Error deleting user' })
  }
}

export const getRoles = async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      include: roleInclude,
      orderBy: { name: 'asc' },
    })

    res.json(roles)
  } catch (err) {
    console.error('Error fetching roles:', err)
    res.status(500).json({ message: 'Error fetching roles' })
  }
}

export const getRoleById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const role = await prisma.role.findUnique({
      where: { id },
      include: roleInclude,
    })

    if (!role) {
      return res.status(404).json({ message: 'Role not found' })
    }

    res.json(role)
  } catch (err) {
    console.error(`Error fetching role ${id}:`, err)
    res.status(500).json({ message: 'Error fetching role' })
  }
}

export const createRole = async (req: Request, res: Response) => {
  const { name, description, permission_ids = [] } = req.body as {
    name?: string
    description?: string
    permission_ids?: string[]
  }

  try {
    const role = await prisma.role.create({
      data: {
        name: name ?? 'new_role',
        description,
        role_permissions: {
          create: permission_ids.map((permission_id) => ({ permission_id })),
        },
      },
      include: roleInclude,
    })

    res.status(201).json(role)
  } catch (err: any) {
    console.error('Error creating role:', err)
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Role name already exists' })
    }
    res.status(500).json({ message: 'Error creating role' })
  }
}

export const updateRole = async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, description, permission_ids = [] } = req.body as {
    name?: string
    description?: string
    permission_ids?: string[]
  }

  try {
    const role = await prisma.role.update({
      where: { id },
      data: {
        name,
        description,
        role_permissions: {
          deleteMany: {},
          create: permission_ids.map((permission_id) => ({ permission_id })),
        },
      },
      include: roleInclude,
    })

    res.json(role)
  } catch (err: any) {
    console.error(`Error updating role ${id}:`, err)
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Role name already exists' })
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Role not found' })
    }
    res.status(500).json({ message: 'Error updating role' })
  }
}

export const deleteRole = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.role.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting role ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Role not found' })
    }
    res.status(500).json({ message: 'Error deleting role' })
  }
}

export const getPermissions = async (_req: Request, res: Response) => {
  try {
    const permissions = await prisma.permission.findMany({
      include: {
        module: {
          select: {
            id: true,
            key: true,
            name: true,
          },
        },
      },
      orderBy: [{ module: { name: 'asc' } }, { action: 'asc' }],
    })

    res.json(permissions)
  } catch (err) {
    console.error('Error fetching permissions:', err)
    res.status(500).json({ message: 'Error fetching permissions' })
  }
}


