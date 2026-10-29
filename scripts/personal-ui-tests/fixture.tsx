import React, { useState } from 'react'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import { createRoot } from 'react-dom/client'
import { DismissibleLayerProvider } from '../../apps/electron/src/renderer/context/DismissibleLayerContext'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '../../packages/shared/src/i18n/setupI18n'
import { AnnotatableMarkdownDocument } from '../../packages/ui/src/components/overlay/AnnotatableMarkdownDocument'
import { DocumentFormattedMarkdownOverlay } from '../../packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay'
import { TurnCard } from '../../packages/ui/src/components/chat/TurnCard'
import { getCanonicalText, resolveNodeOffset } from '../../packages/ui/src/components/annotations/annotation-core'
import { resolveDomTextAnnotations } from '../../packages/ui/src/components/annotations/mermaid-annotations'
import type { AnnotationV1 } from '@craft-agent/core'
import '../../apps/electron/src/renderer/index.css'
setupI18n([initReactI18next]).changeLanguage('en')
const content = '# 图表批注回归\n\n图前文字 Before diagram.\n\n```mermaid\nflowchart LR\n A[中文开始] --> B[重复标签]\n A --> C[重复标签]\n B --> D[中文结束]\n C --> D\n```\n\n图后文字 After diagram.\n\n```mermaid\nsequenceDiagram\n participant A as 用户\n participant B as 系统\n A->>B: 提交请求\n B-->>A: 返回结果\n```\n'
function Fixture() {
 const [annotations,setAnnotations]=useState<AnnotationV1[]>([])
 const [open,setOpen]=useState(false)
 const [turn,setTurn]=useState(new URLSearchParams(location.search).get('host') === 'turn')
 const add=(id:string,a:AnnotationV1)=>setAnnotations(v=>[...v,a])
 const remove=(id:string,key:string)=>setAnnotations(v=>v.filter(a=>a.id!==key))
 const update=(id:string,key:string,patch:Partial<AnnotationV1>)=>setAnnotations(v=>v.map(a=>a.id===key?{...a,...patch}:a))
 const shared={messageId:'fixture-message',sessionId:'fixture-session',annotations,onAddAnnotation:add,onRemoveAnnotation:remove,onUpdateAnnotation:update}
 ;(window as any).fixture={annotations, content, seed:setAnnotations, canonical:getCanonicalText, resolveNodeOffset, resolve:resolveDomTextAnnotations, openDocument:()=>setOpen(true)}
 return <main style={{padding:32,maxWidth:1100,margin:'auto'}}>
  <button id="open-document" onClick={()=>setOpen(true)}>Open document</button>{' '}
  <button id="toggle-turn" onClick={()=>setTurn(v=>!v)}>Toggle TurnCard</button>{' '}
  <button id="toggle-theme" onClick={()=>document.documentElement.classList.toggle('dark')}>Toggle theme</button>
  <div id="inline-document" style={{marginTop:30}}>{turn?<TurnCard turnId="fixture-turn" activities={[]} response={{text:content,messageId:'fixture-message',annotations,isStreaming:false}} sessionId="fixture-session" isStreaming={false} isComplete={true} onAddAnnotation={add} onRemoveAnnotation={remove} onUpdateAnnotation={update}/>:<AnnotatableMarkdownDocument content={content} {...shared}/>}</div>
  <DocumentFormattedMarkdownOverlay content={content} isOpen={open} onClose={()=>setOpen(false)} {...shared}/>
 </main>
}
const fixture = <TooltipProvider><Fixture/></TooltipProvider>
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('bridge') === 'app' ? <DismissibleLayerProvider>{fixture}</DismissibleLayerProvider> : fixture);
