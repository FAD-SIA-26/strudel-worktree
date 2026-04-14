import express from 'express'
import cors from 'cors'
import type { Db } from '../db/client'
import type { CommandQueue } from '../events/commandQueues'
import { createRoutes } from './routes'

export interface AppDeps {
  db:         Db
  leadQueues: Map<string, CommandQueue<any>>
  dashboardUrl?: string
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()
  app.use(cors())
  app.use(express.json())
  if (deps.dashboardUrl) {
    app.get('/', (_req, res) => {
      res.redirect(deps.dashboardUrl!)
    })
  }
  app.use('/api', createRoutes(deps))
  return app
}
