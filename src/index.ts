import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import bodyParser from 'body-parser'
import path from 'node:path'
import { prisma } from './lib/prisma'

// Import routes
import institutionsRoutes from './routes/institutions/institutions'
import clientsRoutes from './routes/clients/clients'
import servicesRoutes from './routes/servicios/services'
import ordersRoutes from './routes/orders/orders'
import orderItemsRoutes from './routes/orderItems/orderItems'
import deliveryRoutes from './routes/delivery/delivery'
import reportsRoutes from './routes/reports/reports'
import paymentsRoutes from './routes/payments/payments'
import usersRoutes from './routes/users/users'
import profilesRoutes from './routes/profiles/profiles'
import authRoutes from './routes/auth/auth'
import plantsRoutes from './routes/plants/plants'
import zonesRoutes from './routes/zones/zones'
import cardnetRoutes from './routes/integrations/cardnet'
import multer from 'multer'

const app = express()
const port = process.env.PORT || 8082

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3100,http://localhost:3200,http://localhost:3400')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true)
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:')) {
        return callback(null, true)
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`))
    },
    credentials: true,
  })
)
app.use(bodyParser.json())
app.use(cookieParser())

// Routes
app.use('/api/institutions', institutionsRoutes)
app.use('/api/clients', clientsRoutes)
app.use('/api/services', servicesRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/order-items', orderItemsRoutes)
app.use('/api/delivery', deliveryRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/payments', paymentsRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/profiles', profilesRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/plants', plantsRoutes)
app.use('/api/zones', zonesRoutes)
app.use('/api/integrations/cardnet', cardnetRoutes)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// Basic route
app.get('/', (_req, res) => {
  res.send('Miss Cleaner API is running')
})

// Start the server
const startServer = async () => {
  try {
    await prisma.$connect()
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`)
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

startServer()
