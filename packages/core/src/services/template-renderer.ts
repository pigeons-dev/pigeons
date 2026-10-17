import vm from 'node:vm'
import { render } from '@react-email/render'
import { transform } from 'sucrase'

export async function renderTemplate(
  source: string,
  data: Record<string, unknown> = {},
): Promise<{ html: string; text: string }> {
  const element = await buildElement(source, data)
  const html = await render(element, { pretty: true })
  const text = await render(element, { plainText: true })
  return { html, text }
}

async function buildElement(
  source: string,
  data: Record<string, unknown>,
): Promise<React.ReactElement> {
  const React = await import('react')
  const components = await import('@react-email/components')

  const stripped = source
    .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^import\s+{[^}]*}\s+from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+\w+;?\s*$/gm, '')

  let code: string
  try {
    const result = transform(stripped, {
      transforms: ['jsx', 'typescript'],
      jsxRuntime: 'classic',
      production: true,
    })
    code = result.code
  } catch {
    code = stripped
  }

  const componentNames = Object.keys(components)
  const sandbox = Object.create(null) as Record<string, unknown>
  sandbox.React = React
  sandbox.components = components
  sandbox.data = data
  sandbox.createElement = React.createElement
  sandbox.__result = undefined
  for (const name of componentNames) {
    sandbox[name] = (components as Record<string, unknown>)[name]
  }

  const script = `
    ${code}
    const _exported = typeof Template === 'function' ? Template
      : typeof exports !== 'undefined' && typeof exports.default === 'function' ? exports.default
      : null;
    if (_exported) __result = _exported(data);
    else throw new Error('Template must export a Template function');
  `

  vm.runInNewContext(script, sandbox, { timeout: 1000 })

  return sandbox.__result as React.ReactElement
}

export function interpolateSubject(
  subject: string,
  data: Record<string, unknown>,
): string {
  return subject.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] != null ? String(data[key]) : `{{${key}}}`
  })
}
