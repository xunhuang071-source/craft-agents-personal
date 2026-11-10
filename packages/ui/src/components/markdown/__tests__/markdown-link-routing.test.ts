import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import { classifyMarkdownLinkTarget, resolveMarkdownLinkTarget } from '../link-target'
import { markdownUrlTransform } from '../url-transform'

describe('resolveMarkdownLinkTarget', () => {
  it('resolves absolute unix file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toEqual({
      kind: 'file',
      path: '/Users/balintorosz/.craft-agent/sessions/abc/image.jpg',
    })
  })

  it('resolves parent-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('../downloads/assets/screenshot.png')).toEqual({
      kind: 'file',
      path: '../downloads/assets/screenshot.png',
    })
  })

  it('resolves repo-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('apps/electron/resources/docs/browser-tools.md')).toEqual({
      kind: 'file',
      path: 'apps/electron/resources/docs/browser-tools.md',
    })
  })

  it('resolves unix file URLs as file targets', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toEqual({
      kind: 'file',
      path: '/Users/tester/report.xlsx',
    })
  })

  it('decodes percent-encoded unix file URLs', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report%20final.pdf')).toEqual({
      kind: 'file',
      path: '/Users/tester/report final.pdf',
    })
  })

  it('decodes a percent-encoded space in a BARE local file path (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/My%20Docs/report%20final.pptx')).toEqual({
      kind: 'file',
      path: '/Users/tester/My Docs/report final.pptx',
    })
  })

  it('leaves a bare path with an invalid percent-sequence untouched (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/100%done/notes.md')).toEqual({
      kind: 'file',
      path: '/Users/tester/100%done/notes.md',
    })
  })

  it('normalizes windows drive-letter file URLs to local paths', () => {
    expect(resolveMarkdownLinkTarget('file:///C:/Users/Tester/Deck.pptx')).toEqual({
      kind: 'file',
      path: 'C:/Users/Tester/Deck.pptx',
    })
  })

  it('resolves https links as url targets', () => {
    expect(resolveMarkdownLinkTarget('https://example.com/image.jpg')).toEqual({
      kind: 'url',
      url: 'https://example.com/image.jpg',
    })
  })

  it('resolves mailto links as url targets', () => {
    expect(resolveMarkdownLinkTarget('mailto:test@example.com')).toEqual({
      kind: 'url',
      url: 'mailto:test@example.com',
    })
  })
})

describe('local file link regressions', () => {
  it.each([
    '/Users/test/Mobile Documents/com~apple~CloudDocs/工作/报告 final.pdf',
    '/Users/test/输出目录/',
    '/Users/test/LICENSE',
    '/Users/test/report.unlisted',
    '/Users/test/报告.md:12:3',
    '~/工作/图表.png',
    './输出/文件.docx',
    '../输出目录/',
  ])('recognizes explicit local paths: %s', (path) => {
    expect(resolveMarkdownLinkTarget(path)).toEqual({ kind: 'file', path })
  })

  it.each([
    'https://example.com/报告.pdf',
    '//example.com/report.pdf',
    'mailto:test@example.com',
    'javascript:alert(1)',
    'data:text/html,test',
    'craftagents://action/new-session',
    '#section',
  ])('keeps URL targets out of the local file handler: %s', (url) => {
    expect(resolveMarkdownLinkTarget(url)).toEqual({ kind: 'url', url })
  })

  it.each([
    ['[报告](</Users/test/Mobile Documents/com~apple~CloudDocs/工作/报告 final.pdf>)',
      '/Users/test/Mobile Documents/com~apple~CloudDocs/工作/报告 final.pdf'],
    ['<a href="/Users/test/com~apple~CloudDocs/报告.pdf">报告</a>',
      '/Users/test/com~apple~CloudDocs/报告.pdf'],
    ['[文件夹](</Users/test/输出目录/>)', '/Users/test/输出目录/'],
    ['[源码](</Users/test/com~apple~CloudDocs/源码.md:12>)',
      '/Users/test/com~apple~CloudDocs/源码.md:12'],
    ['[百分号](</Users/test/完成100%25/图表.png>)', '/Users/test/完成100%/图表.png'],
  ])('routes rendered Markdown/HTML to a decoded local path: %s', (markdown, path) => {
    const targets: ReturnType<typeof resolveMarkdownLinkTarget>[] = []
    renderToStaticMarkup(React.createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      rehypePlugins: [rehypeRaw],
      components: {
        a: ({ href }) => {
          targets.push(resolveMarkdownLinkTarget(href ?? ''))
          return null
        },
      },
      children: markdown,
    }))
    expect(targets).toEqual([{ kind: 'file', path }])
  })
})

describe('markdownUrlTransform', () => {
  it('preserves dangerous anchor hrefs for custom click routing', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('file:///tmp/test.md', 'href', anchorNode as never)).toBe('file:///tmp/test.md')
    expect(markdownUrlTransform('javascript:alert(1)', 'href', anchorNode as never)).toBe('javascript:alert(1)')
  })

  it('still sanitizes dangerous non-anchor URL attributes', () => {
    const imageNode = { tagName: 'img' }
    expect(markdownUrlTransform('javascript:alert(1)', 'src', imageNode as never)).toBe('')
  })

  it('keeps safe anchor hrefs unchanged', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('https://example.com', 'href', anchorNode as never)).toBe('https://example.com')
  })
})

describe('ReactMarkdown anchor rendering with markdownUrlTransform', () => {
  function render(markdown: string): string {
    return renderToStaticMarkup(React.createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: {
        a: ({ href, children }) => React.createElement('a', {
          href: href ? defaultUrlTransform(href) || undefined : undefined,
          'data-raw-href': href,
        }, children),
      },
      children: markdown,
    }))
  }

  it('lets file links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[report](file:///Users/tester/report.pdf)')
    expect(html).toContain('data-raw-href="file:///Users/tester/report.pdf"')
    expect(html).not.toContain('<a href="file:///Users/tester/report.pdf"')
  })

  it('lets javascript links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[boom](javascript:alert(1))')
    expect(html).toContain('data-raw-href="javascript:alert(1)"')
    expect(html).not.toContain('<a href="javascript:alert')
  })

  it('keeps safe web links in the DOM href for normal browser affordances', () => {
    const html = render('[site](https://example.com/path)')
    expect(html).toContain('href="https://example.com/path"')
  })
})

describe('classifyMarkdownLinkTarget', () => {
  it('classifies absolute unix file paths as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toBe('file')
  })

  it('classifies file URLs as file', () => {
    expect(classifyMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toBe('file')
  })

  it('classifies https links as url', () => {
    expect(classifyMarkdownLinkTarget('https://example.com/image.jpg')).toBe('url')
  })

  it('classifies mailto links as url', () => {
    expect(classifyMarkdownLinkTarget('mailto:test@example.com')).toBe('url')
  })
})
