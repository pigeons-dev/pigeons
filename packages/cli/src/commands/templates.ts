import { Command } from 'commander'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const templatesCommand = new Command('templates').description('Manage templates')

templatesCommand
  .command('list')
  .description('List templates')
  .action(async () => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.get('/v1/templates')
      if (result.data.length === 0) {
        console.log('No templates found')
        return
      }
      for (const tpl of result.data) {
        console.log(`  ${tpl.slug.padEnd(30)} v${tpl.version}  ${tpl.name}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

templatesCommand
  .command('get <slug>')
  .description('Get template details')
  .action(async (slug) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const tpl = await client.get(`/v1/templates/${slug}`)
      console.log(`Name:    ${tpl.name}`)
      console.log(`Slug:    ${tpl.slug}`)
      console.log(`Subject: ${tpl.subject}`)
      console.log(`Version: ${tpl.version}`)
      console.log(`Created: ${tpl.createdAt}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

templatesCommand
  .command('push <path>')
  .description('Push template(s) from a file or directory')
  .option('--slug <slug>', 'Template slug (defaults to filename)')
  .option('--name <name>', 'Template name')
  .option('--subject <subject>', 'Email subject line')
  .action(async (path, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const files = getTemplateFiles(path)
      if (files.length === 0) {
        console.error('No .tsx or .jsx files found')
        process.exit(1)
      }

      for (const file of files) {
        const source = readFileSync(file, 'utf-8')
        const slug = opts.slug ?? basename(file, extname(file))
        const name = opts.name ?? slug
        const subject = opts.subject ?? `{{subject}}`

        try {
          await client.get(`/v1/templates/${slug}`)
          const result = await client.patch(`/v1/templates/${slug}`, { body: source, name, subject })
          console.log(`  ✓ updated  ${slug}  (v${result.version})`)
        } catch {
          const result = await client.post('/v1/templates', { slug, name, subject, body: source })
          console.log(`  ✓ created  ${slug}  (v${result.version})`)
        }
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

templatesCommand
  .command('pull <path>')
  .description('Download templates to a directory')
  .action(async (path) => {
    const config = resolveConfig()
    const client = createClient(config)
    const { writeFileSync, mkdirSync } = await import('node:fs')

    try {
      mkdirSync(path, { recursive: true })
      const result = await client.get('/v1/templates')
      for (const tpl of result.data) {
        const file = join(path, `${tpl.slug}.tsx`)
        writeFileSync(file, tpl.body)
        console.log(`  ✓ ${tpl.slug} → ${file}`)
      }
      console.log(`\nPulled ${result.data.length} template(s)`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

templatesCommand
  .command('preview <slug>')
  .description('Preview a template with sample data')
  .option('--data <json>', 'Template data as JSON')
  .action(async (slug, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const data = opts.data ? JSON.parse(opts.data) : undefined
      const result = await client.post(`/v1/templates/${slug}/preview`, { data })
      console.log(`Subject: ${result.subject}\n`)
      console.log('--- HTML ---')
      console.log(result.html)
      console.log('\n--- Plain Text ---')
      console.log(result.text)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

templatesCommand
  .command('delete <slug>')
  .description('Delete a template')
  .action(async (slug) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.delete(`/v1/templates/${slug}`)
      console.log(`✓ Deleted template: ${slug}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

function getTemplateFiles(path: string): string[] {
  const { statSync } = require('node:fs')
  const stat = statSync(path)

  if (stat.isFile()) return [path]
  if (stat.isDirectory()) {
    return readdirSync(path)
      .filter((f: string) => f.endsWith('.tsx') || f.endsWith('.jsx'))
      .map((f: string) => join(path, f))
  }
  return []
}
