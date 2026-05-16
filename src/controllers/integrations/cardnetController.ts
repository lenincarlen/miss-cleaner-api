import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { normalizeBigInts } from '../../utils/serialization'

// === ESTADO DE CONFIGURACIONES ===
const CARDNET_ENV = process.env.CARDNET_ENV || 'test' // 'test' | 'production'
const CARDNET_BASE_URL = CARDNET_ENV === 'production'
    ? 'https://servicios.cardnet.com.do/servicios/tokens'
    : 'https://labservicios.cardnet.com.do/servicios/tokens'

const PRIVATE_KEY = process.env.CARDNET_PRIVATE_KEY || '9kYH2uY5zoTD-WBMEoc0KNRQYrC7crPRJ7zPegg3suXguw_8L-rZDQ__'
const PUBLIC_KEY = process.env.CARDNET_PUBLIC_KEY || 'mfH9CqiAFjFQh_gQR_1TQG_I56ONV7HQ'

// === SERVICIO CARDNET ===
export class CardnetService {
    private static instance: CardnetService

    private constructor() { }

    public static getInstance(): CardnetService {
        if (!CardnetService.instance) {
            CardnetService.instance = new CardnetService()
        }
        return CardnetService.instance
    }

    private async request(endpoint: string, data: any, method: 'POST' | 'GET' = 'POST') {
        const url = `${CARDNET_BASE_URL}${endpoint}`

        // Auth Basic con el PrivateKey como Username, Password vacio.
        const authHeader = 'Basic ' + Buffer.from(`${PRIVATE_KEY}:`).toString('base64')

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: method === 'POST' ? JSON.stringify(data) : undefined
        })

        const responseData = await response.json()

        if (!response.ok) {
            throw {
                status: response.status,
                data: responseData
            }
        }

        return responseData
    }

    // Convertir monto decimal a entero de 2 decimales según documentación (ej. 100.50 -> 10050)
    private formatAmount(amount: number): number {
        return Math.round(amount * 100)
    }

    async processPurchase(token: string, orderId: string, amount: number) {
        // 1. Ejecutar Purchase
        const purchaseData = {
            TrxToken: token,
            Order: orderId,
            Amount: this.formatAmount(amount),
            Currency: "DOP",
            Capture: true, // true para autorizar y capturar de inmediato
            DataDo: {
                Invoice: `INV-${orderId}`,
                Tax: 0 // Ajustar según requerimientos contables si lleva ITBIS separado
            }
        }

        const result = await this.request('/v1/api/purchase', purchaseData, 'POST')
        return result
    }

    async tokenizeDirect(email: string, pan: string, cvv: string, expiration: string, titular: string, customerId: number) {
        // Endpoint seguro especial de tokenización
        const url = `${CARDNET_BASE_URL}/secure/api/Token?commerceKey=${PRIVATE_KEY}`

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                Email: email,
                Pan: pan,
                CVV: cvv,
                Expiration: expiration,
                Titular: titular,
                CustomerId: customerId
            })
        })

        const data = await response.json()
        if (!response.ok) {
            throw { status: response.status, data }
        }
        return data
    }
}

const cardnetService = CardnetService.getInstance()

// === CONTROLADORES API ===

export const processPayment = async (req: Request, res: Response) => {
    try {
        const { token, orderId, amount } = req.body

        if (!token || !orderId || !amount) {
            return res.status(400).json({ message: 'Parámetros requeridos: token, orderId, amount' })
        }

        // Procesar con CardNet
        const result = await cardnetService.processPurchase(token, orderId, amount)

        // Evaluar estado para actualizar DB
        // TransactionStatusId: 1 = Approved, 2 = Pending, 3 = Preauthorized, 4 = Rejected
        const trxData = result?.Response?.Transaction

        // Aquí puedes registrar el cobro en tu base de datos (Ej: tabla Payments, Orders)
        if (trxData && trxData.TransactionStatusId === 1) {
            // Registrar pago aprobado en BD
            /*
            await prisma.payment.create({
              data: {
                amount: Number(amount),
                payment_method: 'cardnet',
                reference_code: trxData.ApprovalCode,
                status: 'paid',
                // relacionarlo a la orden o reporte correspondiente...
              }
            })
            */

            return res.status(200).json({
                message: 'Pago procesado exitosamente',
                approval_code: trxData.ApprovalCode,
                raw_response: result.Response
            })
        } else {
            return res.status(400).json({
                message: 'Pago rechazado o pendiente',
                transactions_status: trxData?.Status || 'Unknown',
                raw_response: result.Response || result
            })
        }

    } catch (error: any) {
        console.error('Error al procesar pago en CardNet:', error?.data || error)
        res.status(error?.status || 500).json({
            message: 'Error en la pasarela de pago',
            details: error?.data?.Errors || error.message
        })
    }
}

export const directTokenize = async (req: Request, res: Response) => {
    try {
        const { email, pan, cvv, expiration, titular, customerId } = req.body

        if (!pan || !cvv || !expiration || !customerId) {
            return res.status(400).json({ message: 'Faltan parámetros de tarjeta o customer' })
        }

        const result = await cardnetService.tokenizeDirect(email, pan, cvv, expiration, titular, Number(customerId))

        res.status(201).json({
            message: 'Tokenización exitosa',
            token: result?.Token?.TokenId,
            raw_response: result
        })
    } catch (error: any) {
        console.error('Error en Tokenizacion Directa:', error?.data || error)
        res.status(error?.status || 500).json({
            message: 'Error al tokenizar tarjeta',
            details: error?.data?.Errors || error.message
        })
    }
}
