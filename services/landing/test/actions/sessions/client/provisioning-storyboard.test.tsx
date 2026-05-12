import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  computeStepIndex,
  cumulativeSum,
  hashString,
  seededShuffle,
} from '../../../../app/actions/sessions/client/provisioning-storyboard.tsx'

describe('provisioning-storyboard pure helpers', () => {
  describe('cumulativeSum', () => {
    it('computes prefix sums', () => {
      assert.deepEqual(cumulativeSum([3, 4, 5, 6, 7]), [3, 7, 12, 18, 25])
    })

    it('handles single-element input', () => {
      assert.deepEqual(cumulativeSum([42]), [42])
    })
  })

  describe('computeStepIndex', () => {
    const cumulative = [3, 7, 12, 18, 25]

    it('maps elapsed < first cumulative to step 0', () => {
      assert.equal(computeStepIndex(0, cumulative), 0)
      assert.equal(computeStepIndex(2.9, cumulative), 0)
    })

    it('advances to step 1 at the first boundary', () => {
      assert.equal(computeStepIndex(3, cumulative), 1)
      assert.equal(computeStepIndex(6.9, cumulative), 1)
    })

    it('advances through interior steps', () => {
      assert.equal(computeStepIndex(7, cumulative), 2)
      assert.equal(computeStepIndex(12, cumulative), 3)
    })

    it('plateaus on the last step past the total', () => {
      assert.equal(computeStepIndex(18, cumulative), 4)
      assert.equal(computeStepIndex(25, cumulative), 4)
      assert.equal(computeStepIndex(120, cumulative), 4) // no overflow
    })
  })

  describe('hashString', () => {
    it('is deterministic — same input produces same hash', () => {
      assert.equal(hashString('01HABCDEF'), hashString('01HABCDEF'))
    })

    it('produces a non-zero uint32', () => {
      const h = hashString('01HABCDEFGHJKMNPQRSTVWXYZ0')
      assert.ok(h >= 0)
      assert.ok(h <= 0xffffffff)
    })

    it('different inputs produce different hashes', () => {
      // FNV-1a has reasonable distribution; two arbitrary ULIDs
      // should differ.
      assert.notEqual(hashString('01HAAAAAA'), hashString('01HBBBBBB'))
    })
  })

  describe('seededShuffle', () => {
    it('returns a permutation of the input', () => {
      const out = seededShuffle([3, 4, 5, 6, 7], hashString('s1'))
      assert.equal(out.length, 5)
      assert.deepEqual(out.toSorted(), [3, 4, 5, 6, 7])
    })

    it('preserves the input sum (so storyboard total stays 25s)', () => {
      const out = seededShuffle([3, 4, 5, 6, 7], hashString('session-x'))
      const sum = out.reduce((a, b) => a + b, 0)
      assert.equal(sum, 25)
    })

    it('is deterministic — same seed reproduces same permutation', () => {
      const a = seededShuffle([3, 4, 5, 6, 7], hashString('01HRETRY'))
      const b = seededShuffle([3, 4, 5, 6, 7], hashString('01HRETRY'))
      assert.deepEqual(a, b)
    })

    it('does not mutate the input', () => {
      const input = [3, 4, 5, 6, 7]
      seededShuffle(input, 42)
      assert.deepEqual(input, [3, 4, 5, 6, 7])
    })
  })
})
