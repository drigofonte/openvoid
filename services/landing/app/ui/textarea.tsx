export interface TextareaProps {
  name: string
  placeholder?: string
  defaultValue?: string
  required?: boolean
  rows?: number
  id?: string
}

/**
 * Multi-line text input — extends `.wf-input` with `display: block`
 * and `min-height: 84px` (per the wireframe canvas's Create-screen
 * variant). The user's prompt to the agent lands here.
 */
export function Textarea() {
  return ({ name, placeholder, defaultValue, required, rows = 4, id }: TextareaProps) => (
    <textarea
      class="wf-input"
      id={id}
      name={name}
      rows={rows}
      placeholder={placeholder}
      defaultValue={defaultValue}
      required={required || undefined}
    />
  )
}
