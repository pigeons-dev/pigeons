import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const sequencesCommand = new Command('sequences').description('Manage sequences')

sequencesCommand
  .command('list')
  .description('List sequences')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      let path = `/v1/sequences?limit=${opts.limit}`
      if (opts.status) path += `&status=${opts.status}`

      const result = await client.get(path)
      if (result.data.length === 0) {
        console.log('No sequences found')
        return
      }
      for (const s of result.data) {
        const stats = s.stats ? ` (${s.stats.enrolled} enrolled, ${s.stats.active} active)` : ''
        console.log(`  ${s.id}  ${s.name.padEnd(30)} ${s.status}${stats}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('get <id>')
  .description('Get sequence details with steps')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const s = await client.get(`/v1/sequences/${id}`)
      console.log(`ID:      ${s.id}`)
      console.log(`Name:    ${s.name}`)
      console.log(`Status:  ${s.status}`)
      if (s.trigger) console.log(`Trigger: ${JSON.stringify(s.trigger)}`)
      if (s.steps?.length) {
        console.log(`\nSteps:`)
        for (const step of s.steps) {
          const detail = step.type === 'email'
            ? step.subject ?? step.templateId ?? ''
            : step.type === 'delay'
            ? step.delayDuration ?? ''
            : 'condition'
          console.log(`  ${step.position + 1}. [${step.type}] ${detail}`)
        }
      }
      if (s.stats) {
        console.log(`\nStats: enrolled=${s.stats.enrolled} active=${s.stats.active} completed=${s.stats.completed} exited=${s.stats.exited}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('create')
  .description('Create a sequence')
  .requiredOption('--name <name>', 'Sequence name')
  .option('--trigger <json>', 'Trigger configuration JSON')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, unknown> = { name: opts.name }
      if (opts.trigger) body.trigger = JSON.parse(opts.trigger)

      const seq = await client.post('/v1/sequences', body)
      console.log(`Created sequence: ${seq.name} (${seq.id})`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('activate <id>')
  .description('Activate a sequence')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const seq = await client.post(`/v1/sequences/${id}/activate`, {})
      console.log(`Activated sequence: ${seq.name}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('pause <id>')
  .description('Pause a sequence')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.post(`/v1/sequences/${id}/pause`, {})
      console.log(`Paused sequence: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('enroll <sequenceId> <contactId>')
  .description('Enroll a contact in a sequence')
  .action(async (sequenceId, contactId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const enrollment = await client.post(`/v1/sequences/${sequenceId}/enroll`, { contactId })
      console.log(`Enrolled contact ${contactId} in sequence (${enrollment.id})`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

sequencesCommand
  .command('enrollments <id>')
  .description('List enrollments for a sequence')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '25')
  .action(async (id, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      let path = `/v1/sequences/${id}/enrollments?limit=${opts.limit}`
      if (opts.status) path += `&status=${opts.status}`

      const result = await client.get(path)
      if (result.data.length === 0) {
        console.log('No enrollments found')
        return
      }
      for (const e of result.data) {
        console.log(`  ${e.id}  contact=${e.contactId}  status=${e.status}  enrolled=${e.enrolledAt}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
