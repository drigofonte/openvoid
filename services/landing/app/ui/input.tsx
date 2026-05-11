export interface InputProps {
  name: string
  /**
   * Defaults to `text`. Remix 3's accessible-input typings split the
   * input element into discriminated branches per role/type, so we
   * pass `type` as a literal at the JSX call site below rather than
   * a runtime variable.
   */
  type?: 'text' | 'url' | 'email'
  placeholder?: string
  defaultValue?: string
  required?: boolean
  autoComplete?: string
  id?: string
}

/**
 * Text input — renders the canonical `.field` shape via the
 * `.field` block (36h, --r-sm radius, --card bg, inset 1px
 * line, accent halo on focus).
 *
 * `defaultValue` becomes the `value=` HTML attribute (the
 * server-rendered initial value). React-style `defaultValue=` is
 * not preserved through Remix 3's renderer — unknown attribute
 * names get lowercased, and the browser ignores `defaultvalue=`.
 */
export function Input() {
  return ({
    name,
    type = 'text',
    placeholder,
    defaultValue,
    required,
    autoComplete = 'off',
    id,
  }: InputProps) => {
    if (type === 'url') {
      return (
        <input
          class="field"
          id={id}
          name={name}
          type="url"
          placeholder={placeholder}
          value={defaultValue}
          required={required || undefined}
          autoComplete={autoComplete}
        />
      )
    }
    if (type === 'email') {
      return (
        <input
          class="field"
          id={id}
          name={name}
          type="email"
          placeholder={placeholder}
          value={defaultValue}
          required={required || undefined}
          autoComplete={autoComplete}
        />
      )
    }
    return (
      <input
        class="field"
        id={id}
        name={name}
        type="text"
        placeholder={placeholder}
        value={defaultValue}
        required={required || undefined}
        autoComplete={autoComplete}
      />
    )
  }
}
