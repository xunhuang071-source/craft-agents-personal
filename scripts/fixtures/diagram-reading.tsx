import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MarkdownMermaidBlock } from '../../packages/ui/src/components/markdown/MarkdownMermaidBlock'
import { ImagePreviewOverlay } from '../../packages/ui/src/components/overlay/ImagePreviewOverlay'
import { captureMermaidSelection } from '../../packages/ui/src/components/annotations/mermaid-annotations'
Object.assign(window, { captureMermaidFixture: captureMermaidSelection })

i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {
  overlay: { zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom' },
} } }, initImmediate: false })
const samples = [
  ['flow', 'graph LR; A[需求] --> B[方案] --> C[交付]'],
  ['vertical', 'graph TD; A[开始] --> B[处理] --> C[结束]'],
  ['sequence', 'sequenceDiagram\nparticipant A as 业务人员\nparticipant B as 智能助手\nA->>B: 提交问题\nB-->>A: 返回结果'],
  ['wide', 'graph LR\nA[业务需求与目标确认] --> B[数据准备与质量检查] --> C[能力选择与方案设计] --> D[应用验证与反馈改进] --> E[成果交付与持续运行]'],
]
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#94bdf4"/><text x="30" y="140" font-size="24">Preview fixture</text></svg>')
const load = async () => { await new Promise(resolve => setTimeout(resolve, 30)); return image }
function App() {
  const [open, setOpen] = React.useState(false)
  return <main>
    <p>正文参考：图表内的文字应与这行字协调。</p>
    <button id="open-image" onClick={() => setOpen(true)}>Open image fixture</button>
    {samples.map(([id, code]) => <section id={id} key={id} data-ca-block-type="mermaid" data-ca-block-id={id} data-ca-block-path={'fixture/' + id} style={{ width: 'min(650px, 100%)', margin: '24px 0' }}>
      <MarkdownMermaidBlock code={code!} />
    </section>)}
    <ImagePreviewOverlay isOpen={open} onClose={() => setOpen(false)} filePath="fixture.svg" loadDataUrl={load} />
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
