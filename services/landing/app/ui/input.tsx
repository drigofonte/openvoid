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
 * Text input — 34px height, 8px radius, focus ring in the accent
 * colour. Maps to `wireframe-primitives.jsx`'s `.wf-input` class.
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
          class="wf-input"
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
          class="wf-input"
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
        class="wf-input"
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
