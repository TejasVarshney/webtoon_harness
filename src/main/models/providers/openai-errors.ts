import OpenAI from 'openai'
import { ProviderError } from './types'

export function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof OpenAI.APIUserAbortError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
}

export function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout', message)
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return new ProviderError('auth', message)
  if (err instanceof OpenAI.RateLimitError) return new ProviderError('rate_limit', message)
  if (err instanceof OpenAI.BadRequestError) return new ProviderError('bad_request', message)
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError('network', message)
  return new ProviderError('unknown', message)
}
