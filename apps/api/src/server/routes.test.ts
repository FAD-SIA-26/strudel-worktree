import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestDb } from '../db/client'
import { createApp } from './app'
import { CommandQueue } from '../events/commandQueues'

describe('routes', () => {
  it('GET /api/orchestration returns sections array', async () => {
    const db = createTestDb()
    const app = createApp({ db, leadQueues: new Map() })
    const res = await request(app).get('/api/orchestration')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sections')
  })

  it('GET / redirects to the dashboard when configured', async () => {
    const db = createTestDb()
    const app = createApp({
      db,
      leadQueues: new Map(),
      dashboardUrl: 'http://localhost:3000',
    })

    const res = await request(app).get('/')

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://localhost:3000')
  })

  it('POST /api/approve enqueues ForceApprove to lead queue', async () => {
    const db = createTestDb()
    const leadQ = new CommandQueue<any>()
    const leadQueues = new Map([['drums-lead', leadQ]])
    const app = createApp({ db, leadQueues })
    const res = await request(app).post('/api/approve').send({ workerId: 'drums-v1', leadId: 'drums-lead' })
    expect(res.status).toBe(202)
    expect(leadQ.size).toBe(1)
  })
})
