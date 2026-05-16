import { Router } from 'express'

import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getPermissions,
} from '../../controllers/users/usersController'

const router = Router()

router.get('/', getUsers)
router.get('/roles/list', getRoles)
router.get('/roles/:id', getRoleById)
router.post('/roles', createRole)
router.put('/roles/:id', updateRole)
router.delete('/roles/:id', deleteRole)

router.get('/permissions/all', getPermissions)

router.get('/:id', getUserById)
router.post('/', createUser)
router.put('/:id', updateUser)
router.delete('/:id', deleteUser)

export default router


