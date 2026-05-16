import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'

type EmployeeCreateInput = {
  profile_id: string
  institution_id: string
  job_title?: string | null
  department?: string | null
  employment_status?: string | null
  hire_date?: string | null
  termination_date?: string | null
  notes?: string | null
}

type EmployeeUpdateInput = Partial<EmployeeCreateInput>

// Get all employees
export const getEmployees = async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        profile: {
          select: {
            id: true,
            full_name: true,
            institution_id: true,
            payment_mode: true,
            institution: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        institution: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    })

    res.json(employees)
  } catch (err) {
    console.error('Error fetching employees:', err)
    res.status(500).json({ message: 'Error fetching employees' })
  }
}

// Get employee by ID
export const getEmployeeById = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        profile: {
          select: {
            id: true,
            full_name: true,
            institution_id: true,
            payment_mode: true,
            institution: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        institution: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' })
    }

    res.json(employee)
  } catch (err) {
    console.error(`Error fetching employee with id ${id}:`, err)
    res.status(500).json({ message: 'Error fetching employee' })
  }
}

// Create a new employee
export const createEmployee = async (req: Request, res: Response) => {
  const {
    profile_id,
    institution_id,
    job_title,
    department,
    employment_status,
    hire_date,
    termination_date,
    notes,
  }: EmployeeCreateInput = req.body

  try {
    const employee = await prisma.employee.create({
      data: {
        profile: {
          connect: { id: profile_id },
        },
        institution: {
          connect: { id: institution_id },
        },
        job_title: job_title ?? undefined,
        department: department ?? undefined,
        employment_status: employment_status ?? undefined,
        hire_date: hire_date ? new Date(hire_date) : undefined,
        termination_date: termination_date ? new Date(termination_date) : undefined,
        notes: notes ?? undefined,
      },
      include: {
        profile: true,
        institution: true,
      },
    })

    res.status(201).json(employee)
  } catch (err: any) {
    console.error('Error creating employee:', err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Related entity not found' })
    }
    if (err.code === 'P2002') {
      return res.status(400).json({ message: 'Employee already exists' })
    }
    res.status(500).json({ message: 'Error creating employee' })
  }
}

// Update an employee
export const updateEmployee = async (req: Request, res: Response) => {
  const { id } = req.params
  const data: EmployeeUpdateInput = req.body

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        institution: data.institution_id
          ? {
              connect: { id: data.institution_id },
            }
          : undefined,
        job_title: data.job_title ?? undefined,
        department: data.department ?? undefined,
        employment_status: data.employment_status ?? undefined,
        hire_date: data.hire_date ? new Date(data.hire_date) : data.hire_date === null ? null : undefined,
        termination_date: data.termination_date ? new Date(data.termination_date) : data.termination_date === null ? null : undefined,
        notes: data.notes ?? undefined,
      },
      include: {
        profile: true,
        institution: true,
      },
    })

    res.json(employee)
  } catch (err: any) {
    console.error(`Error updating employee with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Employee not found' })
    }
    res.status(500).json({ message: 'Error updating employee' })
  }
}

// Delete an employee
export const deleteEmployee = async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await prisma.employee.delete({
      where: { id },
    })

    res.status(204).send()
  } catch (err: any) {
    console.error(`Error deleting employee with id ${id}:`, err)
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Employee not found' })
    }
    res.status(500).json({ message: 'Error deleting employee' })
  }
}
