import React from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '../../packages/shared/src/i18n/setupI18n'
import { Markdown } from '../../packages/ui/src/components/markdown/Markdown'
import '../../apps/electron/src/renderer/index.css'

setupI18n([initReactI18next]).changeLanguage('zh-CN')
const calls: { action: string; path: string }[] = []
;(window as any).finderFixture = { calls }
const markdown = `
[icloud](</Users/test/Mobile Documents/com~apple~CloudDocs/工作/报告 final.pdf>)

<a href="/Users/test/com~apple~CloudDocs/图片.png">html-image</a>

[folder](</Users/test/输出目录/>)

[line](</Users/test/com~apple~CloudDocs/源码.md:12:3>)

[unknown](</Users/test/成果.custom>)

[file-url](file:///Users/test/%E6%8A%A5%E5%91%8A.pdf)

[website](https://example.com/report.pdf)

[unsafe](javascript:alert(1))
`
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <Markdown
      onFileClick={path => calls.push({ action: 'showInFolder', path })}
      onUrlClick={path => calls.push({ action: 'openUrl', path })}
    >{markdown}</Markdown>
  </TooltipProvider>
)
