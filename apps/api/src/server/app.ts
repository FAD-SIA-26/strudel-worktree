import type { OrcCommand } from "@orc/types";
import cors from "cors";
import express from "express";
import type { Db } from "../db/client";
import type { CommandQueue } from "../events/commandQueues";
import { createRoutes } from "./routes";

export interface AppDeps {
  db: Db;
  leadQueues: Map<string, CommandQueue<OrcCommand>>;
  dashboardUrl?: string;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const { dashboardUrl } = deps;
  if (dashboardUrl) {
    app.get("/", (_req, res) => {
      res.redirect(dashboardUrl);
    });
  }
  app.use("/api", createRoutes(deps));
  return app;
}
