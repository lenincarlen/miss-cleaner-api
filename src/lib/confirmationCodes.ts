/**
 * Utilidades para generar y validar códigos de confirmación
 * Los códigos son alfanuméricos de 6-8 caracteres para facilitar su digitación
 */

/**
 * Genera un código de confirmación único
 * Formato: 6-8 caracteres alfanuméricos (mayúsculas, sin caracteres confusos como 0/O, 1/I)
 */
export function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Sin 0, O, 1, I
  const length = 6
  let code = ''
  
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  
  return code
}

/**
 * Valida el formato de un código de confirmación
 */
export function isValidConfirmationCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false
  const cleanCode = code.trim().toUpperCase()
  
  // Debe ser alfanuméricos, sin caracteres confusos, 6-8 caracteres
  const regex = /^[A-HJ-Z2-9]{6,8}$/
  return regex.test(cleanCode)
}

/**
 * Normaliza un código (mayúsculas, sin espacios)
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

