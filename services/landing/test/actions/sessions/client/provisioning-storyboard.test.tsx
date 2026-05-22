import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  STUCK_THRESHOLD_MS,
  TOTAL_STEPS,
  barFillPctForStep,
  stepClassFor,
} from '../../../../app/actions/sessions/client/provisioning-storyboard.tsx'

describe('provisioning-storyboard pure helpers', () => {
  describe('stepClassFor', () => {
    it('marks earlier steps as `step done`', () => {
      assert.equal(stepClassFor(0, 2), 'step done')
      assert.equal(stepClassFor(1, 2), 'step done')
    })

    it('marks the current step as `step active`', () => {
      assert.equal(stepClassFor(2, 2), 'step active')
    })

    it('marks future steps as `step`', () => {
      assert.equal(stepClassFor(3, 2), 'step')
      assert.equal(stepClassFor(4, 0), 'step')
    })
  })

  describe('barFillPctForStep', () => {
    it('grows monotonically as activeStep advances', () => {
      const widths = [0, 1, 2, 3, 4].map((s) => barFillPctForStep(s))
      for (let i = 1; i < widths.length; i += 1) {
        assert.ok(widths[i]! > widths[i - 1]!)
      }
    })

    it('caps at 95% on the final step (the page-replace lands the user on Ready)', () => {
      assert.equal(barFillPctForStep(TOTAL_STEPS - 1), 95)
    })

    it('clamps negative or out-of-range steps', () => {
      assert.equal(barFillPctForStep(-1), barFillPctForStep(0))
      assert.equal(barFillPctForStep(99), barFillPctForStep(TOTAL_STEPS - 1))
    })

    it('returns 0 when totalSteps is 0 (defensive — never happens in real usage)', () => {
      assert.equal(barFillPctForStep(2, 0), 0)
    })
  })

  describe('STUCK_THRESHOLD_MS', () => {
    it('is 60s — preserves the pre-U10 "taking longer than usual" cadence', () => {
      assert.equal(STUCK_THRESHOLD_MS, 60_000)
    })
  })

  describe('TOTAL_STEPS', () => {
    it('matches the 5 server-side PendingPhase values mapped via derive.activeStepFor', () => {
      assert.equal(TOTAL_STEPS, 5)
    })
  })
})
