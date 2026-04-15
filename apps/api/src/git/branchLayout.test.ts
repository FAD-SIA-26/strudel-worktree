import { describe, expect, it } from 'vitest'
import { laneBranchName } from './branchLayout'

describe('laneBranchName', () => {
  it('names lane branches under the run id', () => {
    expect(laneBranchName('r1', 'melody')).toBe('lane/r1/melody')
  })
})
