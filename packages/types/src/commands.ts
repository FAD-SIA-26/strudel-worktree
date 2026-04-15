import { z } from 'zod'
export const SpawnWorkerCmd      = z.object({ commandType: z.literal('SpawnWorker'),      workerId: z.string(), prompt: z.string(), strategy: z.string().optional(), errorHistory: z.array(z.string()).default([]) })
export const AbortCmd            = z.object({ commandType: z.literal('Abort'),            targetWorkerId: z.string().optional() })
export const AcceptProposalCmd   = z.object({ commandType: z.literal('AcceptProposal') })
export const SelectWinnerCmd     = z.object({ commandType: z.literal('SelectWinner'),     workerId: z.string() })
export const InjectConstraintCmd = z.object({ commandType: z.literal('InjectConstraint'), constraint: z.string() })
export const OrcCommandSchema    = z.discriminatedUnion('commandType', [SpawnWorkerCmd, AbortCmd, AcceptProposalCmd, SelectWinnerCmd, InjectConstraintCmd])
export type OrcCommand = z.infer<typeof OrcCommandSchema>
