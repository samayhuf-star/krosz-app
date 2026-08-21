import type { ProviderContext, ProviderResult } from "./types.ts";

// Build a successful or failed ProviderResult. The request_id is always the one stamped
// on the call's ProviderContext, so a single operation can be traced across usage + audit logs.
export function okResult<T>(ctx: ProviderContext, operation: string, data: T): ProviderResult<T> {
  return {
    success: true,
    provider: { providerId: ctx.providerId, key: ctx.providerKey, category: ctx.category },
    operation,
    request_id: ctx.requestId,
    data,
  };
}

export function failResult(
  ctx: ProviderContext,
  operation: string,
  opts: { error_code?: string; error_message?: string; retryable?: boolean }
): ProviderResult {
  return {
    success: false,
    provider: { providerId: ctx.providerId, key: ctx.providerKey, category: ctx.category },
    operation,
    request_id: ctx.requestId,
    error_code: opts.error_code,
    error_message: opts.error_message,
    retryable: Boolean(opts.retryable),
  };
}