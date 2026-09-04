import { isStemRole, roleLabel, roleOptions, type StemRole } from '../lib/roles'

interface Props {
  value: StemRole
  inUse: readonly StemRole[]
  source: 'guessed' | 'kit' | 'user'
  duplicate: boolean
  onChange: (role: StemRole) => void
}

export function RolePicker({ value, inUse, source, duplicate, onChange }: Props) {
  const options = roleOptions([...inUse, value])
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => {
          if (isStemRole(e.target.value)) onChange(e.target.value)
        }}
        aria-label="Stem role"
        className="role-picker rounded-md border border-rule bg-surface py-1 pl-2 text-sm font-medium text-ink hover:border-ink-soft focus:border-rust focus:outline-none"
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      {duplicate && (
        <span
          title="Another track already has this role"
          aria-label="Duplicate role"
          className="inline-block h-2 w-2 rounded-full bg-amber"
        />
      )}
      {source === 'kit' && <span className="font-display text-xs italic text-moss">from kit</span>}
      {source === 'guessed' && value !== 'other' && <span className="font-display text-xs italic text-muted">guessed</span>}
      {source === 'guessed' && value === 'other' && <span className="font-display text-xs italic text-rust">unrecognised</span>}
    </div>
  )
}
