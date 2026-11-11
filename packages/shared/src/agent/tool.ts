import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/** Local tool descriptor shared by host tools and in-process MCP servers. */
export function tool<Shape extends z.ZodRawShape, Result>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: z.output<z.ZodObject<Shape>>) => Promise<Result>,
  options?: { annotations?: ToolAnnotations },
) {
  return { name, description, inputSchema, handler, annotations: options?.annotations };
}
