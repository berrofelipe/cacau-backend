// Minimal client for the Omie ERP API (https://developer.omie.com.br).
//
// Omie uses a JSON-RPC-like protocol: every request is a POST to
// https://app.omie.com.br/api/v1/<resource>/ with a body of
// { call, app_key, app_secret, param: [payload] }. Errors come back either
// as HTTP 500/403 or as a 200 with { faultstring, faultcode } in the body.

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1"
const REQUEST_TIMEOUT_MS = 15000

export class OmieError extends Error {
  faultcode: string | null
  httpStatus: number

  constructor(message: string, faultcode: string | null, httpStatus: number) {
    super(message)
    this.name = "OmieError"
    this.faultcode = faultcode
    this.httpStatus = httpStatus
  }
}

export function omieConfigured(): boolean {
  return !!(process.env.OMIE_APP_KEY && process.env.OMIE_APP_SECRET)
}

// Omie signals "record not found" on Consultar* calls with a fault instead of
// an empty response. There is no stable list of codes across resources, so we
// match on both the known codes and the message.
export function isOmieNotFound(err: unknown): boolean {
  if (!(err instanceof OmieError)) return false
  return (
    /-5113$|-20$/.test(err.faultcode || "") ||
    /n[aã]o (localizado|encontrado|cadastrado)/i.test(err.message)
  )
}

export async function omieCall<T = any>(
  resource: string,
  call: string,
  payload: Record<string, unknown>
): Promise<T> {
  if (!omieConfigured()) {
    throw new OmieError("OMIE_APP_KEY / OMIE_APP_SECRET não configuradas", null, 0)
  }

  const res = await fetch(`${OMIE_BASE_URL}/${resource}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [payload],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  let body: any = null
  try {
    body = await res.json()
  } catch {
    throw new OmieError(`Omie respondeu HTTP ${res.status} sem corpo JSON`, null, res.status)
  }

  if (body && typeof body === "object" && "faultstring" in body) {
    throw new OmieError(String(body.faultstring), body.faultcode ? String(body.faultcode) : null, res.status)
  }
  if (!res.ok) {
    throw new OmieError(`Omie respondeu HTTP ${res.status}`, null, res.status)
  }
  return body as T
}
