// frontend/components/ArchitectureDiagram.tsx
'use client'

import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

interface Props {
  mermaidCode: string
}

export default function ArchitectureDiagram({ mermaidCode }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mermaid.initialize({
      startOnLoad:    false,
      theme:          'dark',
      themeVariables: {
        background:     '#0b0e17',
        primaryColor:   '#ffa53d',
        secondaryColor: '#1a2035',
        tertiaryColor:  '#151a27',
        lineColor:      '#7a8298',
        textColor:      '#edf0f6',
      },
    })
  }, [])

  useEffect(() => {
    if (!ref.current || !mermaidCode) return

    ref.current.innerHTML = ''
    const id  = `mermaid-${Date.now()}`
    const div = document.createElement('div')
    div.id          = id
    div.className   = 'mermaid'
    div.textContent = mermaidCode
    ref.current.appendChild(div)

    mermaid.run({ nodes: [div] }).catch(console.error)
  }, [mermaidCode])

  if (!mermaidCode) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80px', color: 'var(--dx-ink-mute)', fontSize: '12px', fontFamily: 'var(--dx-mono)' }}>
        다이어그램 데이터 없음
      </div>
    )
  }

  return <div ref={ref} style={{ width: '100%', overflowX: 'auto', padding: '8px 0' }} />
}