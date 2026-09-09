import { useState, type KeyboardEvent } from 'react'
import { Link } from '@rspress/core/theme-original'
import { Arrow } from './icons'

export interface ShowcaseData {
  label: string
  title: string
  description: string
  note: string
  link: string
  linkText: string
  stages: {
    name: string
    title: string
    description: string
    file: string
    code: string
    tags: string[]
  }[]
}

export function Showcase({ data }: { data: ShowcaseData }) {
  const [selected, setSelected] = useState(0)
  const stage = data.stages[selected]
  if (import.meta.env.SSG_MD) {
    return <>{`\n## ${data.title}\n\n${data.description}\n\n${data.stages.map(item => `### ${item.name}: ${item.title}\n\n${item.description}\n\n${item.file}\n\n\`\`\`text\n${item.code}\n\`\`\`\n\n${item.tags.join(' · ')}\n`).join('\n')}\n${data.note}\n\n[${data.linkText}](${data.link})\n`}</>
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % data.stages.length
    if (event.key === 'ArrowLeft') next = (index - 1 + data.stages.length) % data.stages.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = data.stages.length - 1
    if (next === undefined) return
    event.preventDefault()
    setSelected(next)
    document.getElementById(`showcase-tab-${next}`)?.focus()
  }
  return (
    <section className="showcase" aria-labelledby="showcase-title">
      <div className="showcase-intro">
        <p className="eyebrow">{data.label}</p>
        <h2 id="showcase-title">{data.title}</h2>
        <p>{data.description}</p>
        <Link className="text-link" href={data.link}>{data.linkText}<Arrow /></Link>
      </div>
      <div className="showcase-instrument">
        <div className="instrument-top"><span className="instrument-indicator" aria-hidden="true" /><span>{data.label}</span><span className="instrument-index">0{selected + 1} / 0{data.stages.length}</span></div>
        <div className="showcase-tabs" role="tablist" aria-label={data.title}>
          {data.stages.map((item, index) => <button key={item.name} role="tab" id={`showcase-tab-${index}`} aria-selected={index === selected} aria-controls="showcase-panel" tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}><span>0{index + 1}</span>{item.name}</button>)}
        </div>
        <div role="tabpanel" id="showcase-panel" aria-labelledby={`showcase-tab-${selected}`} tabIndex={0} className="showcase-panel">
          <div className="method-card">
            <div className="method-file"><span className="file-symbol" aria-hidden="true">⌁</span>{stage.file}<span className="file-corner" aria-hidden="true" /></div>
            <pre><code>{stage.code}</code></pre>
          </div>
          <div className="showcase-explanation"><h3>{stage.title}</h3><p>{stage.description}</p><ul>{stage.tags.map(tag => <li key={tag}>{tag}</li>)}</ul></div>
        </div>
        <p className="showcase-note">{data.note}</p>
      </div>
    </section>
  )
}
