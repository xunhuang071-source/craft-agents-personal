export interface LlmValidationConfig {
  /** Model to test with */
  model: string;
  /** API key credential (x-api-key header) */
  apiKey?: string;
  /** OAuth/bearer token (Authorization: Bearer header) */
  oauthToken?: string;
  /** Custom base URL for Anthropic-compatible endpoints */
  baseUrl?: string;
}

export interface LlmValidationResult {
  success: boolean;
  error?: string;
}

/** Verify that the configured model responds to the Anthropic Messages API. */
export async function validateAnthropicConnection(config: LlmValidationConfig): Promise<LlmValidationResult> {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = new Headers({ 'content-type': 'application/json', 'anthropic-version': '2023-06-01' });
  if (config.apiKey) headers.set('x-api-key', config.apiKey);
  else if (config.oauthToken) headers.set('authorization', `Bearer ${config.oauthToken}`);

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
      body: JSON.stringify({ model: config.model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply OK.' }] }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { success: false, error: parseValidationError(String(response.status)) };
    }
    const payload = await response.json() as { type?: string; content?: unknown };
    if (payload?.type !== 'message' || !Array.isArray(payload.content)) {
      return { success: false, error: 'Endpoint did not return an Anthropic message.' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: parseValidationError(error instanceof Error ? error.message : 'Connection failed') };
  }
}

/**
 * Parse error messages into user-friendly descriptions.
 * Centralizes error message translation for all connection validation.
 */
export function parseValidationError(msg: string): string {
  const lowerMsg = msg.toLowerCase();

  // Connection errors — server unreachable
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.';
  }

  // Auth errors
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('authentication')) {
    return 'Authentication failed. Check your API key or OAuth token.';
  }

  // Permission errors
  if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
    return 'Access denied. Check your API key permissions.';
  }

  // Rate limit / quota errors
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('quota')) {
    return 'Rate limited or quota exceeded. Try again later.';
  }

  // Credit/billing errors
  if (lowerMsg.includes('402') || lowerMsg.includes('credit') || lowerMsg.includes('billing') || lowerMsg.includes('insufficient')) {
    return 'Billing issue. Check your account credits or payment method.';
  }

  // Model not found
  if (lowerMsg.includes('model not found') || lowerMsg.includes('invalid model')) {
    return 'Model not found. Check the connection configuration.';
  }

  // 404 on endpoint
  if (lowerMsg.includes('404') && !lowerMsg.includes('model')) {
    return 'Endpoint not found. Ensure the server supports the Anthropic Messages API.';
  }

  // Service unavailable
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503') || lowerMsg.includes('service unavailable')) {
    return 'API temporarily unavailable. Try again in a few seconds.';
  }

  // Fallback
  return msg.slice(0, 200);
}
