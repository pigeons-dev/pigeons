import type { ResolvedConfig } from './config.js'

export function createClient(config: ResolvedConfig) {
  async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.url}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = (await res.json()) as any

    if (!res.ok) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`
      throw new Error(msg)
    }

    return data as T
  }

  return {
    get: <T = any>(path: string) => request<T>('GET', path),
    post: <T = any>(path: string, body: unknown) => request<T>('POST', path, body),
    patch: <T = any>(path: string, body: unknown) => request<T>('PATCH', path, body),
    delete: <T = any>(path: string) => request<T>('DELETE', path),
  }
}
