export const normalizeBigInts = <T>(input: T): T => {
  if (input === null || input === undefined) return input

  if (typeof input === 'bigint') {
    return Number(input) as unknown as T
  }

  if (input instanceof Date) {
    return input
  }

  if (Array.isArray(input)) {
    return input.map((item) => normalizeBigInts(item)) as unknown as T
  }

  if (typeof input === 'object') {
    const maybeDecimal = input as Record<string, unknown> & { toNumber?: () => number }

    if (typeof maybeDecimal.toNumber === 'function') {
      return maybeDecimal.toNumber() as unknown as T
    }

    const entries = Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      normalizeBigInts(value),
    ])

    return Object.fromEntries(entries) as T
  }

  return input
}

export const extractCookieValue = (cookieHeader?: string | null, cookieName?: string) => {
  if (!cookieHeader || !cookieName) return null

  const cookies = cookieHeader
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  for (const cookie of cookies) {
    if (cookie.startsWith(`${cookieName}=`)) {
      return cookie.substring(`${cookieName}=`.length)
    }
  }

  return null
}

