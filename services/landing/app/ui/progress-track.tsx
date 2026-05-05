import { css } from 'remix/ui'

export interface ProgressTrackProps {
  /** 0–100 progress percentage. */
  value: number
}

/**
 * Linear progress bar — track + fill. Wireframe variant 03-A uses
 * this above the lifecycle steps; v1 sets a fixed value while
 * provisioning, then animates indirectly via the `wf-pulse` class on
 * active step icons (handled by `<Provisioning>` in Unit 4).
 */
export function ProgressTrack() {
  return ({ value }: ProgressTrackProps) => {
    let clamped = Math.max(0, Math.min(100, value))
    return (
      <div class="wf-progress-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
        <div class="wf-progress-fill" mix={css({ width: `${clamped}%` })} />
      </div>
    )
  }
}
