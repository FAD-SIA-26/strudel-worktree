import { describe, expect, it } from 'vitest'
import { OrcCommandSchema } from './commands'

describe('OrcCommandSchema', () => {
  it('parses AcceptProposal', () => {
    expect(OrcCommandSchema.parse({ commandType: 'AcceptProposal' }).commandType).toBe('AcceptProposal')
  })

  it('parses SelectWinner', () => {
    expect(OrcCommandSchema.parse({ commandType: 'SelectWinner', workerId: 'melody-v2' }).commandType).toBe('SelectWinner')
  })
})
