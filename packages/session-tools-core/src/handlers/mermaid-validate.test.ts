import { describe, expect, it, spyOn } from 'bun:test';
import * as pele from 'pele';
import type { SessionToolContext } from '../context.ts';
import { handleMermaidValidate } from './mermaid-validate.ts';

const context = {} as SessionToolContext;

function parseResult(result: Awaited<ReturnType<typeof handleMermaidValidate>>) {
  return JSON.parse(result.content[0]!.text) as {
    valid: boolean;
    message?: string;
    error?: string;
    suggestion?: string;
  };
}

const diagrams = [
  ['flowchart', 'flowchart LR\n A[开始] -->|继续| B[完成]'],
  ['sequence', 'sequenceDiagram\n participant A as 用户\n participant B as 助手\n A->>B: 请求\n B-->>A: 响应'],
  ['state', 'stateDiagram-v2\n [*] --> Idle\n Idle --> Active: 启动\n Active --> [*]'],
  ['class', 'classDiagram\n class Animal {\n +String name\n +speak()\n }\n Animal <|-- Cat'],
  ['er', 'erDiagram\n CUSTOMER ||--o{ ORDER : places\n CUSTOMER {\n string name\n }'],
  ['gantt', 'gantt\n dateFormat YYYY-MM-DD\n title 计划\n section 开发\n 编码 :a1, 2026-10-01, 3d\n 测试 :after a1, 2d'],
  ['pie', 'pie title 份额\n "甲" : 40\n "乙" : 60'],
  ['mindmap', 'mindmap\n root((中心))\n   分支甲\n   分支乙'],
  ['xychart', 'xychart-beta\n title "收入"\n x-axis [Jan, Feb, Mar]\n y-axis "元" 0 --> 100\n bar [25, 45, 80]\n line [20, 50, 70]'],
] as const;

async function expectInvalid(code: string, message?: RegExp) {
  const result = await handleMermaidValidate(context, { code });
  expect(result.isError).toBe(true);
  const body = parseResult(result);
  expect(body.valid).toBe(false);
  expect(typeof body.error).toBe('string');
  expect(body.suggestion).toBe('Check the syntax against ~/.craft-agent/docs/mermaid.md');
  if (message) expect(body.error).toMatch(message);
}

describe('handleMermaidValidate', () => {
  for (const [type, code] of diagrams) {
    it(`validates ${type} using the renderer and retains the success response`, async () => {
      const result = await handleMermaidValidate(context, { code });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe('text');
      expect(parseResult(result)).toEqual({ valid: true, message: 'Diagram syntax is valid' });
    });
  }

  it('accepts frontmatter, comments and init directives after leading BOM/whitespace', async () => {
    const code = '\uFEFF\n---\ntitle: 配置标题\nconfig:\n  flowchart:\n    nodeSpacing: 100\n---\n%% comment\n%%{init: {"flowchart": {"rankSpacing": 150}}}%%\nflowchart LR\n A[甲]-->B[乙]';
    const renderSpy = spyOn(pele, 'render');
    try {
      const result = await handleMermaidValidate(context, { code });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result).valid).toBe(true);
      expect(renderSpy.mock.calls[0]?.[0]).toBe(code.trimStart());
    } finally {
      renderSpy.mockRestore();
    }
  });

  for (const code of [
    '',
    'notADiagram\n A --> B',
    'flowchart LR\n A[Unclosed',
    'sequenceDiagram\n A->>B',
    'classDiagram\n class A {',
    'erDiagram\n A ||--o{',
    'pie\n "Invalid" : nope',
  ]) {
    it(`reports invalid syntax: ${code.split('\n')[0] || '(empty)'}`, async () => {
      await expectInvalid(code);
    });
  }

  it('validates layout even when the caller sets render=false', async () => {
    const renderSpy = spyOn(pele, 'render').mockImplementation(() => {
      throw new pele.PeleError('Invalid layout fixture', 'semantic');
    });
    try {
      const result = await handleMermaidValidate(context, { code: 'flowchart LR\n A-->B', render: false });
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
      expect(parseResult(result).error).toBe('Invalid layout fixture');
    } finally {
      renderSpy.mockRestore();
    }
  });

  it('uses fixed safe render options that author configuration cannot override', async () => {
    const code = [
      '---', 'config:', '  securityLevel: loose', '  links: true', '  images: true', '---',
      'flowchart LR',
      ' A@{ img: "https://example.invalid/image.png", label: "图片", h: 60, w: 60 } --> B',
      ' click B "https://example.invalid/link" "tip"',
    ].join('\n');
    const renderSpy = spyOn(pele, 'render');
    try {
      const result = await handleMermaidValidate(context, { code, render: true });
      expect(result.isError).toBeUndefined();
      expect(renderSpy).toHaveBeenCalledWith(code, expect.objectContaining({
        idPrefix: 'mermaid-validation',
        responsive: false,
        autoDirection: false,
        links: false,
        images: false,
        limit: 50_000,
        outputLimit: 4_000_000,
        maxEdges: 5_000,
        fontFamily: expect.stringContaining('PingFang SC'),
      }));
      const svg = (renderSpy.mock.results[0]!.value as pele.RenderResult).svg;
      expect(svg).not.toMatch(/<a\b|<image\b|<script\b|<foreignObject\b|\b(?:xlink:)?href=/i);
      expect(svg).not.toContain('https://example.invalid');
    } finally {
      renderSpy.mockRestore();
    }
  });

  it('does not promote label HTML into executable SVG content', async () => {
    const code = 'flowchart LR\n A["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(1)>"]\n click A "javascript:alert(1)"';
    const renderSpy = spyOn(pele, 'render');
    try {
      const result = await handleMermaidValidate(context, { code });
      expect(result.isError).toBeUndefined();
      const svg = (renderSpy.mock.results[0]!.value as pele.RenderResult).svg;
      expect(svg).not.toMatch(/<script\b|<img\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/i);
    } finally {
      renderSpy.mockRestore();
    }
  });

  it('enforces source size before removing leading whitespace', async () => {
    await expectInvalid(' '.repeat(50_000) + 'flowchart LR\n A-->B', /50000/);
  });

  it('enforces the flowchart edge limit', async () => {
    await expectInvalid('flowchart LR\n' + 'A-->B\n'.repeat(5_001), /5000/);
  });

  it('enforces SVG output size for a source below 50,000 characters', async () => {
    const code = 'mindmap\n root\n' + '  a\n'.repeat(12_000);
    expect(code.length).toBeLessThan(50_000);
    await expectInvalid(code, /4000000/);
  });
});
