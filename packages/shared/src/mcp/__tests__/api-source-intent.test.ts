/**
 * The agent's intent reaches an API source's tool: the Claude source proxy takes `_intent`
 * out of the arguments and passes it as `PoolCallToolOptions.intent`; API tools declare
 * `_intent` and use it for large-result handling.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiSourcePoolClient } from '../api-source-pool-client.ts';

describe('ApiSourcePoolClient intent', () => {
  test('passes the agent intent to the API tool as `_intent`, without overriding one it already has', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const server = new McpServer({ name: 'api_test', version: '1.0.0' });
    server.registerTool('api_test', {
      description: 'test',
      inputSchema: { path: z.string(), _intent: z.string().optional() },
    }, async (args) => {
      seen.push(args);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });
    const client = new ApiSourcePoolClient(server);
    await client.callTool('api_test', { path: '/search' }, { intent: 'find the outage thread' });
    await client.callTool('api_test', { path: '/search', _intent: 'own' }, { intent: 'other' });
    await client.callTool('api_test', { path: '/search' });
    expect(seen).toEqual([
      { path: '/search', _intent: 'find the outage thread' },
      { path: '/search', _intent: 'own' },
      { path: '/search' },
    ]);
    await client.close();
  });
});
