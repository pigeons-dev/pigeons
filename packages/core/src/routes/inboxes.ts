import { Router } from 'express'
import { z } from 'zod'
import {
  createInbox,
  getInbox,
  listInboxes,
  updateInbox,
  deleteInbox,
  pauseInbox,
  resumeInbox,
  setCatchAll,
  listMessages,
  getMessage,
  listThreads,
  getThread,
  updateThread,
} from '../services/inbox-service.js'
import { sendInboxMessage } from '../services/inbox-sender.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  emailAddress: z.string().email(),
  description: z.string().max(1000).optional(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  labels: z.array(z.string()).optional(),
})

const updateInboxSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  labels: z.array(z.string()).optional(),
  autoReplyEnabled: z.boolean().optional(),
})

const updateThreadSchema = z.object({
  status: z.enum(['open', 'closed', 'snoozed']).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const sendMessageSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  inReplyTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
})

export function createInboxRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createInboxSchema.parse(req.body)
      const result = await createInbox(db, body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const result = await listInboxes(db, {
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        cursor: req.query.cursor as string | undefined,
        status: req.query.status as string | undefined,
        label: req.query.label as string | undefined,
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await getInbox(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateInboxSchema.parse(req.body)
      const result = await updateInbox(db, req.params.id, body)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await deleteInbox(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/pause', async (req, res, next) => {
    try {
      const result = await pauseInbox(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/resume', async (req, res, next) => {
    try {
      const result = await resumeInbox(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/catch-all', async (req, res, next) => {
    try {
      const result = await setCatchAll(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  // Messages

  router.get('/:id/messages', async (req, res, next) => {
    try {
      const result = await listMessages(db, req.params.id, {
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        cursor: req.query.cursor as string | undefined,
        direction: req.query.direction as string | undefined,
        threadId: req.query.thread_id as string | undefined,
        label: req.query.label as string | undefined,
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/messages/:messageId', async (req, res, next) => {
    try {
      const result = await getMessage(db, req.params.id, req.params.messageId)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/messages', async (req, res, next) => {
    try {
      const body = sendMessageSchema.parse(req.body)
      const result = await sendInboxMessage(db, config, req.params.id, body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  // Threads

  router.get('/:id/threads', async (req, res, next) => {
    try {
      const result = await listThreads(db, req.params.id, {
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        cursor: req.query.cursor as string | undefined,
        status: req.query.status as string | undefined,
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/threads/:threadId', async (req, res, next) => {
    try {
      const result = await getThread(db, req.params.id, req.params.threadId)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id/threads/:threadId', async (req, res, next) => {
    try {
      const body = updateThreadSchema.parse(req.body)
      const result = await updateThread(db, req.params.id, req.params.threadId, body)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
