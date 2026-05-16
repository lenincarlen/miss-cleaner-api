import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0 ? process.env.JWT_SECRET : 'dev-secret-key'

type DecodedToken = { sub?: string; role?: string | null }

const extractToken = (req: Request): string | null => {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  const adminCookie = req.cookies?.['miss-cleaner__admin']
  if (adminCookie) return adminCookie
  const webCookie = req.cookies?.['miss-cleaner__web']
  if (webCookie) return webCookie
  return null
}

export const requirePermissionOrRoles = (permissionAction: string, allowedRoles: string[] = []) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req)
      if (!token) return res.status(401).json({ message: 'No autorizado' })

      const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken
      const userId = decoded.sub
      if (!userId) return res.status(401).json({ message: 'Token inválido' })

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              role_permissions: {
                include: { permission: true },
              },
            },
          },
          user_roles: {
            include: {
              role: {
                include: {
                  role_permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!user) return res.status(401).json({ message: 'Usuario no encontrado' })

      // Combine roles from direct relation and join table
      const roles = new Set<string>()
      if (user.role?.name) {
        roles.add(user.role.name)
      }
      user.user_roles?.forEach((userRole) => {
        if (userRole.role?.name) {
          roles.add(userRole.role.name)
        }
      })

      // Check if any of the user's roles are in the allowed list (case-insensitive)
      const hasAllowedRole = [...roles].some((roleName) =>
        allowedRoles.includes(roleName.toLowerCase())
      )
      if (hasAllowedRole) {
        return next()
      }

      // Combine permissions from all roles
      const permissions = new Set<string>()
      if (user.role?.role_permissions) {
        user.role.role_permissions.forEach((rp) => {
          if (rp.permission?.action) {
            permissions.add(rp.permission.action)
          }
        })
      }
      user.user_roles?.forEach((userRole) => {
        userRole.role?.role_permissions?.forEach((rp) => {
          if (rp.permission?.action) {
            permissions.add(rp.permission.action)
          }
        })
      })

      // Check for the specific permission
      if (permissions.has(permissionAction)) {
        return next()
      }

      return res.status(403).json({ message: 'Permisos insuficientes' })
    } catch (err) {
      console.error('AuthZ middleware error:', err)
      return res.status(401).json({ message: 'No autorizado' })
    }
  }
}
