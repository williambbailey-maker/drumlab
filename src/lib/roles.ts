/**
 * Stem roles and filename-based role guessing.
 *
 * Roles are the fixed vocabulary from CLAUDE.md. Toms are open-ended
 * (`tom_1..n`) so they get a template-literal type rather than a union.
 */

export const FIXED_ROLES = [
  'kick_in',
  'kick_out',
  'snare_top',
  'snare_bottom',
  'hat',
  'oh_l',
  'oh_r',
  'oh_mono',
  'room_l',
  'room_r',
  'room_mono',
  'other',
] as const

export type FixedRole = (typeof FIXED_ROLES)[number]
export type TomRole = `tom_${number}`
export type StemRole = FixedRole | TomRole

export function isTomRole(role: string): role is TomRole {
  return /^tom_\d+$/.test(role)
}

/** 1-based tom number, or 0 for non-tom roles. */
export function tomIndex(role: StemRole): number {
  return isTomRole(role) ? Number(role.slice(4)) : 0
}

export function isStemRole(value: string): value is StemRole {
  return (FIXED_ROLES as readonly string[]).includes(value) || isTomRole(value)
}

const LABELS: Record<FixedRole, string> = {
  kick_in: 'Kick in',
  kick_out: 'Kick out',
  snare_top: 'Snare top',
  snare_bottom: 'Snare bottom',
  hat: 'Hat',
  oh_l: 'OH L',
  oh_r: 'OH R',
  oh_mono: 'OH mono',
  room_l: 'Room L',
  room_r: 'Room R',
  room_mono: 'Room mono',
  other: 'Other',
}

export function roleLabel(role: StemRole): string {
  return isTomRole(role) ? `Tom ${tomIndex(role)}` : LABELS[role]
}

/**
 * Ordered list for the role picker. Toms run from 1 to one past the highest
 * tom currently in use (minimum 4) so there is always a free slot to grow into.
 */
export function roleOptions(inUse: readonly StemRole[] = []): StemRole[] {
  const highest = inUse.reduce((m, r) => Math.max(m, tomIndex(r)), 0)
  const tomCount = Math.max(4, highest + 1)
  const toms = Array.from({ length: tomCount }, (_, i) => `tom_${i + 1}` as TomRole)
  return [
    'kick_in',
    'kick_out',
    'snare_top',
    'snare_bottom',
    'hat',
    ...toms,
    'oh_l',
    'oh_r',
    'oh_mono',
    'room_l',
    'room_r',
    'room_mono',
    'other',
  ]
}

/** Stereo placement for sum-to-stereo playback: -1 left, 0 centre, +1 right. */
export function panForRole(role: StemRole): number {
  switch (role) {
    case 'oh_l':
    case 'room_l':
      return -1
    case 'oh_r':
    case 'room_r':
      return 1
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Filename tokenising
// ---------------------------------------------------------------------------

/**
 * Turns a filename into lowercase word tokens. Splits letter/digit boundaries
 * ("oh1" → "oh 1"), splits glued side suffixes ("ohl" → "oh l"), strips a
 * leading track number ("03 kick in") and trailing take numbers
 * ("kick in 01", "kick.02") while keeping meaningful single digits ("tom 2").
 */
export function tokenize(filename: string): string[] {
  let base = filename.split(/[\\/]/).pop() ?? filename
  base = base.replace(/\.[a-z0-9]{2,4}$/i, '')
  base = base.toLowerCase()
  base = base.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  base = base.replace(/\b(oh|ohs|overheads?|ovh|rooms?|rm|amb)(l|r|m|c)\b/g, '$1 $2')
  base = base.replace(/\b(kick|kik|kck|bd)(in|out|sub)\b/g, '$1 $2')
  base = base.replace(/\b(snare|snr|sn|sd)(top|bot|bottom|btm|up|down|side)\b/g, '$1 $2')
  base = base.replace(/\b(hi)(hat|hats)\b/g, '$1 $2')

  let tokens = base.split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length > 1 && /^\d+$/.test(tokens[0])) tokens = tokens.slice(1)
  while (tokens.length > 1 && /^\d{2,}$/.test(tokens[tokens.length - 1])) tokens.pop()
  return tokens
}

const has = (tokens: string[], words: readonly string[]) => tokens.some((t) => words.includes(t))

const KICK = ['kick', 'kik', 'kck', 'bd', 'bassdrum', 'bdrum']
const KICK_OUT = ['out', 'outside', 'ext', 'sub', 'reso', 'res', 'front', 'shell', 'o']
const SNARE = ['snare', 'snr', 'sn', 'sd']
const SNARE_BOTTOM = ['bot', 'bottom', 'btm', 'under', 'down', 'side', 'b']
const HAT = ['hat', 'hats', 'hh', 'hihat', 'hihats']
const TOM = ['tom', 'toms', 'rack', 'floor', 'ft', 'flr', 'ftom', 'rtom']
const TOM_HIGH = ['hi', 'high', 'rack', 'rtom']
const TOM_MID = ['mid', 'middle']
const TOM_LOW = ['low', 'floor', 'ft', 'flr', 'ftom']
const OH = ['oh', 'ohs', 'overhead', 'overheads', 'ovh', 'over']
const ROOM = ['room', 'rooms', 'rm', 'amb', 'ambience', 'ambient', 'far', 'crush', 'smash']
const LEFT = ['l', 'left', 'lt']
const RIGHT = ['r', 'right', 'rt']
const MONO = ['m', 'mono', 'c', 'center', 'centre', 'mid', 'middle']

type Side = 'l' | 'r' | 'mono'

function detectSide(tokens: string[]): Side {
  if (has(tokens, LEFT) || tokens.includes('1')) return 'l'
  if (has(tokens, RIGHT) || tokens.includes('2')) return 'r'
  if (has(tokens, MONO)) return 'mono'
  return 'mono'
}

/**
 * Best guess at a stem role from a filename alone. Unknown names map to
 * `other`. Tom numbers here are a sort key, not a final slot: pass a whole
 * folder through `assignRoles` to compact them to `tom_1..n`.
 */
export function guessRole(filename: string): StemRole {
  const t = tokenize(filename)
  if (t.length === 0) return 'other'

  if (has(t, KICK)) return has(t, KICK_OUT) ? 'kick_out' : 'kick_in'
  if (has(t, SNARE)) return has(t, SNARE_BOTTOM) ? 'snare_bottom' : 'snare_top'
  if (has(t, HAT)) return 'hat'

  if (has(t, TOM)) {
    const explicit = t.find((x) => /^\d+$/.test(x))
    const n = explicit ? Math.min(12, Math.max(1, Number(explicit))) : 0
    if (has(t, TOM_LOW)) return `tom_${n ? n + 2 : 3}`
    if (has(t, TOM_MID)) return `tom_${n || 2}`
    if (has(t, TOM_HIGH)) return `tom_${n || 1}`
    return `tom_${n || 1}`
  }

  if (has(t, OH)) {
    const side = detectSide(t)
    return side === 'l' ? 'oh_l' : side === 'r' ? 'oh_r' : 'oh_mono'
  }
  if (has(t, ROOM)) {
    const side = detectSide(t)
    return side === 'l' ? 'room_l' : side === 'r' ? 'room_r' : 'room_mono'
  }
  return 'other'
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface RoleAssignment {
  role: StemRole
  source: 'guessed' | 'kit'
}

/**
 * Guess roles for a whole folder. Toms are re-numbered 1..n in order of their
 * guessed position, so "Rack, Floor" becomes tom_1, tom_2 rather than tom_1, tom_3.
 * `byInput` lets a kit profile resolve names that are only an input number.
 */
export function assignRoles(
  filenames: readonly string[],
  byInput?: (filename: string) => StemRole | null,
): RoleAssignment[] {
  const sources: RoleAssignment['source'][] = filenames.map(() => 'guessed')
  const roles = filenames.map((name, i) => {
    const guessed = guessRole(name)
    if (guessed !== 'other' || !byInput) return guessed
    const fromKit = byInput(name)
    if (fromKit) sources[i] = 'kit'
    return fromKit ?? guessed
  })
  const toms = roles
    .map((role, i) => ({ i, key: tomIndex(role) }))
    .filter((x) => x.key > 0)
    .sort((a, b) => a.key - b.key || natural.compare(filenames[a.i], filenames[b.i]))
  toms.forEach((x, n) => {
    roles[x.i] = `tom_${n + 1}`
  })
  return roles.map((role, i) => ({ role, source: sources[i] }))
}
