/**
 * Mermaid Validate Handler
 *
 * Validates Mermaid diagram syntax and layout using Pele's render path.
 * No DOM required - works identically in Claude and Codex.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { PeleError, render } from 'pele';

// Keep this policy in sync with ui/components/markdown/mermaid-renderer.ts.
const SOURCE_LIMIT = 50_000;
const OUTPUT_LIMIT = 4_000_000;
const MAX_EDGES = 5_000;
const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const FONT_FAMILY_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", monospace';

export interface MermaidValidateArgs {
  code: string;
  render?: boolean;
}

/**
 * Handle the mermaid_validate tool call.
 *
 * Always render, including when render=false: parsing alone misses invalid
 * layouts. Keep legitimate frontmatter and init directives, exactly as the UI
 * does. Only leading whitespace/BOM is removed for Pele's type detection.
 * Return the existing valid/message or valid/error/suggestion response shape.
 */
export async function handleMermaidValidate(
  _ctx: SessionToolContext,
  args: MermaidValidateArgs
): Promise<ToolResult> {
  const { code } = args;

  try {
    // Check before trimming so leading whitespace cannot bypass the limit.
    if (code.length > SOURCE_LIMIT) {
      throw new PeleError(`Diagram source is longer than the limit of ${SOURCE_LIMIT} characters.`, 'limit');
    }
    render(code.trimStart(), {
      idPrefix: 'mermaid-validation',
      responsive: false,
      autoDirection: false,
      fontFamily: FONT_FAMILY,
      fontFamilyMono: FONT_FAMILY_MONO,
      links: false,
      images: false,
      limit: SOURCE_LIMIT,
      outputLimit: OUTPUT_LIMIT,
      maxEdges: MAX_EDGES,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: true,
          message: 'Diagram syntax is valid',
        }, null, 2),
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: false,
          error: errorMessage,
          suggestion: 'Check the syntax against ~/.craft-agent/docs/mermaid.md',
        }, null, 2),
      }],
      isError: true,
    };
  }
}
