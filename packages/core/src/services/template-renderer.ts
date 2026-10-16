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
  const fn = new Function(
    'React',
    'components',
    'data',
    `const { ${componentNames.join(', ')} } = components;
    const createElement = React.createElement;
    ${code}
    const _exported = typeof Template === 'function' ? Template
      : typeof exports !== 'undefined' && typeof exports.default === 'function' ? exports.default
      : null;
    if (_exported) return _exported(data);
    throw new Error('Template must export a Template function');`,
  )

  return fn(React, components, data)
}

export function interpolateSubject(
  subject: string,
  data: Record<string, unknown>,
): string {
  return subject.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] != null ? String(data[key]) : `{{${key}}}`
  })
}
