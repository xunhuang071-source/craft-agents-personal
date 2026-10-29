import { mock } from 'bun:test'
// Pure editor-helper tests transitively import the browser-only PDF viewer.
// Bun has neither Vite's ?url transform nor DOMMatrix. Stub that unrelated view
// only; do not mock Pele, Markdown, diagram interactions or annotation code.
// Full browser regressions run the real PDF/Markdown imports without this preload.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/fixture-pdf.worker.mjs' }))
mock.module('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  Document: () => null,
  Page: () => null,
}))
