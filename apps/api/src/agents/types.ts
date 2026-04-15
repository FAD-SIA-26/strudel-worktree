export interface WorkerTask    { id: string; prompt: string; maxRetries: number; strategy?: string; errorHistory: string[] }
export interface WorkerHeartbeat { ts?: number; pid?: number; output?: string }
export interface WorkerContext {
  worktreePath: string
  branch: string
  baseBranch: string
  entityId: string
  planPath: string
  leadPlanPath: string
  runPlanPath: string
  domainSkillName?: string
  domainSkillContent?: string
  onHeartbeat?: (heartbeat: WorkerHeartbeat) => void | Promise<void>
  onSessionLogOpened?: (sessionPath: string) => void | Promise<void>
}
export interface WorkerResult {
  status: "done" | "failed";
  branch: string;
  diff?: string;
  error?: string;
  retryable: boolean;
}
export interface WorkerAgent {
  run(task: WorkerTask, ctx: WorkerContext): Promise<WorkerResult>;
  abort(): Promise<void>;
}
