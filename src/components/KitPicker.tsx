import { KIT_PROFILES, kitById, type KitProfile } from '../kit/profile'

interface Props {
  value: KitProfile
  onChange: (kit: KitProfile) => void
  compact?: boolean
}

export function KitPicker({ value, onChange, compact = false }: Props) {
  return (
    <label className={`flex items-center gap-2 ${compact ? '' : 'justify-center'}`}>
      <span className={`font-display italic ${compact ? 'text-xs text-muted' : 'text-sm text-ink-soft'}`}>
        {compact ? 'kit' : 'Recording setup'}
      </span>
      <select
        value={value.id}
        onChange={(e) => onChange(kitById(e.target.value))}
        aria-label="Recording setup profile"
        className={`role-picker rounded-md border border-rule bg-surface pl-2 font-medium text-ink hover:border-ink-soft focus:border-rust focus:outline-none ${
          compact ? 'py-0.5 text-xs' : 'py-1.5 text-sm'
        }`}
      >
        {KIT_PROFILES.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
    </label>
  )
}
