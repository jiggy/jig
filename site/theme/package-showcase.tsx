import { useContext, useState, type KeyboardEvent } from 'react'
import { ThemeContext } from '@rspress/core/runtime'
import { CodeBlockRuntime, Link } from '@rspress/core/theme-original'
import { Arrow } from './icons'
import { codeThemes } from './code-themes'

interface Source {
  file: string
  lang: string
  code: string
}
export interface PackageShowcaseData {
  kind: 'package'
  title: string
  description: string
  packageName: string
  packageLabel: string
  requiredLabel: string
  implementationLabel: string
  source: Source
  implementations: Source[]
  caller: Source
  stages: { name: string; title: string; description: string }[]
  inputLabel: string
  input: string
  resultLabel: string
  result: string
  runtimeNote: string
  internalsTitle: string
  internals: string
  precisionTitle: string
  precision: { file: string; description: string; link: string }[]
  note: string
  link: string
  linkText: string
}

// Native Rspress highlighting, using the same palettes as documentation fences.
const highlighting = {
  light: { theme: codeThemes.themes.light, colorReplacements: codeThemes.colorReplacements },
  dark: { theme: codeThemes.themes.dark, colorReplacements: codeThemes.colorReplacements },
}

export function PackageShowcase({ data }: { data: PackageShowcaseData }) {
  const { theme } = useContext(ThemeContext)
  const [selected, setSelected] = useState(0)
  const [language, setLanguage] = useState(0)
  const implementation = data.implementations[language]
  const source = selected === 0 ? data.source : selected === 1 ? implementation : data.caller
  if (import.meta.env.SSG_MD) {
    const block = (source: Source) =>
      `### ${source.file}\n\n\`\`\`${source.lang}\n${source.code}\n\`\`\`\n`
    return (
      <>{`\n<a id="showcase"></a>\n\n## ${data.title}\n\n${data.description}\n\n${data.packageLabel}: ${data.packageName}\n\n${data.requiredLabel}: ${data.source.file}\n\n${data.implementationLabel}\n\n${data.stages.map((stage) => `### ${stage.name}: ${stage.title}\n\n${stage.description}\n`).join('\n')}\n${block(data.source)}\n${data.implementations.map(block).join('\n')}\n${data.runtimeNote}\n\n${data.internalsTitle}\n\n${data.internals}\n\n${block(data.caller)}\n${data.inputLabel}: ${data.input}\n\n${data.resultLabel}: ${data.result}\n\n### ${data.precisionTitle}\n\n${data.precision.map((item) => `- [${item.file}](${item.link}): ${item.description}`).join('\n')}\n\n${data.note}\n\n[${data.linkText}](${data.link})\n`}</>
    )
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % data.stages.length
        : event.key === 'ArrowLeft'
          ? (index + data.stages.length - 1) % data.stages.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? data.stages.length - 1
              : undefined
    if (next === undefined) return
    event.preventDefault()
    setSelected(next)
    document.getElementById(`package-tab-${next}`)?.focus()
  }
  return (
    <section id="showcase" className="showcase package-showcase" aria-labelledby="package-title">
      <div className="showcase-instrument">
        <div className="instrument-chrome" aria-hidden="true">
          <div className="window-dots"><span /><span /><span /></div>
          <span className="chrome-badge">FLOW Engine · Run/0 Protocol</span>
        </div>
        <div className="showcase-tabs" role="tablist" aria-label={data.title}>
          {data.stages.map((stage, index) => (
            <button
              key={stage.name}
              id={`package-tab-${index}`}
              role="tab"
              aria-selected={selected === index}
              aria-controls="package-panel"
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => navigate(event, index)}
            >
              {stage.name}
            </button>
          ))}
        </div>
        <div
          id="package-panel"
          role="tabpanel"
          aria-labelledby={`package-tab-${selected}`}
          tabIndex={0}
        >
          <div className="package-heading">
            <span className="visual-caption">{data.packageName}/</span>
            <span>{data.packageLabel}</span>
          </div>
          <ul className="package-files" aria-label={data.packageLabel}>
            <li>
              <code>{selected === 0 ? data.source.file : implementation.file}</code>
              <span>{data.requiredLabel}</span>
            </li>
          </ul>
          <div className="package-stage-copy">
            <h2>{data.stages[selected].title}</h2>
            <p>{data.stages[selected].description}</p>
          </div>
          {selected === 1 && (
            <div
              className="implementation-picker"
              role="group"
              aria-label={data.implementationLabel}
            >
              {data.implementations.map((item, index) => (
                <button
                  key={item.file}
                  aria-pressed={language === index}
                  onClick={() => setLanguage(index)}
                >
                  {item.file}
                </button>
              ))}
            </div>
          )}
          <div className="package-code">
            <CodeBlockRuntime
              key={source.file}
              lang={source.lang}
              title={source.file}
              code={source.code}
              wrapCode
              shikiOptions={highlighting[theme === 'dark' ? 'dark' : 'light']}
            />
          </div>
          {selected === 1 && (
            <>
              <p className="visual-footnote">{data.runtimeNote}</p>
              <details className="package-internals">
                <summary>{data.internalsTitle}</summary>
                <p>{data.internals}</p>
              </details>
            </>
          )}
          {selected === 2 && (
            <dl className="package-exchange">
              <div>
                <dt>{data.inputLabel}</dt>
                <dd>
                  <code>{data.input}</code>
                </dd>
              </div>
              <div>
                <dt>{data.resultLabel}</dt>
                <dd>
                  <code>{data.result}</code>
                </dd>
              </div>
            </dl>
          )}
        </div>
        <details className="package-precision">
          <summary>{data.precisionTitle}</summary>
          <dl>
            {data.precision.map((item) => (
              <div key={item.file}>
                <dt>
                  <Link href={item.link}>{item.file}</Link>
                </dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        </details>
        <p className="showcase-note">{data.note}</p>
      </div>
      <div className="showcase-intro showcase-caption">
        <h2 id="package-title">{data.title}</h2>
        <p>{data.description}</p>
      </div>
      <Link className="text-link showcase-example" href={data.link}>
        {data.linkText}
        <Arrow />
      </Link>
    </section>
  )
}
