import express from 'express'
import cors from 'cors'
import type { Db } from '../db/client'
import type { CommandQueue } from '../events/commandQueues'
import { createRoutes } from './routes'

export interface AppDeps {
  db:         Db
  leadQueues: Map<string, CommandQueue<any>>
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use('/api', createRoutes(deps))
  return app
}
