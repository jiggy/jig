import { useState, type KeyboardEvent } from 'react'
import { Link } from '@rspress/core/theme-original'
import { Arrow } from './icons'

export interface ShowcaseData {
  kind: 'execution'
  label: string
  title: string
  description: string
  note: string
  link: string
  linkText: string
  inputLabel: string
  input: string
  methodLabel: string
  resultLabel: string
  detailsLabel: string
  caller: { file: string; code: string }
  result: string
  stages: {
    name: string
    title: string
    description: string
    file: string
    code: string
    output: string
    steps: string[]
  }[]
}

export function Showcase({ data }: { data: ShowcaseData }) {
  const [selected, setSelected] = useState(0)
  const stage = data.stages[selected]
  if (import.meta.env.SSG_MD) {
    return <>{`\n<a id="showcase"></a>\n\n## ${data.title}\n\n${data.description}\n\n${data.inputLabel}: ${data.input}\n\n${data.methodLabel}\n\n${data.caller.file}\n\n\`\`\`ts\n${data.caller.code}\n\`\`\`\n\n${data.stages.map(item => `### ${item.name}: ${item.title}\n\n${item.description}\n\n${item.steps.join(' → ')}\n\n${data.resultLabel}: ${item.output}\n\n${item.file}\n\n\`\`\`text\n${item.code}\n\`\`\`\n`).join('\n')}\n${data.result}\n\n${data.note}\n\n[${data.linkText}](${data.link})\n`}</>
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
  return <section id="showcase" className="showcase" aria-labelledby="showcase-title">
    <div className="showcase-instrument">
      <div className="request-card"><span className="visual-caption">{data.inputLabel}</span><p>“{data.input}”</p></div>
      <div className="trace-connector" aria-hidden="true">↓</div>
      <div className="method-envelope">
        <h2>{data.methodLabel}</h2>
        <div className="showcase-tabs" role="tablist" aria-label={data.title}>
          {data.stages.map((item, index) => <button key={item.name} role="tab" id={`showcase-tab-${index}`} aria-selected={index === selected} aria-controls="showcase-panel" tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}>{item.name}</button>)}
        </div>
        <div role="tabpanel" id="showcase-panel" aria-labelledby={`showcase-tab-${selected}`} tabIndex={0} className="showcase-panel">
          <ol className="method-steps" key={selected}>{stage.steps.map(step => <li key={step}>{step}</li>)}</ol>
          <div className="showcase-explanation"><h3>{stage.title}</h3><p>{stage.description}</p></div>
          <div className="showcase-output"><span>{data.resultLabel}</span><strong>{stage.output}</strong></div>
        </div>
      </div>
      <details className="showcase-source"><summary>{data.detailsLabel}</summary>
        <div className="source-columns">
          <div className="method-card showcase-caller"><p className="method-file">{data.caller.file}</p><pre tabIndex={0}><code>{data.caller.code}</code></pre></div>
          <div className="method-card"><p className="method-file">{stage.file}</p><pre tabIndex={0}><code>{stage.code}</code></pre></div>
        </div>
        <p className="showcase-contract">{data.result}</p>
      </details>
      <p className="showcase-note">{data.note}</p>
    </div>
    <div className="showcase-intro showcase-caption">
      <p className="eyebrow">{data.label}</p>
      <h2 id="showcase-title">{data.title}</h2>
      <p>{data.description}</p>
    </div>
    <Link className="text-link showcase-example" href={data.link}>{data.linkText}<Arrow /></Link>
  </section>
}
