/**
 * Kit profiles: what the app knows about a recording setup before the first
 * take is dropped. Distances feed the alignment check's expectations,
 * pairs feed polarity, levels feed the gain sanity check.
 *
 * Distances are metres. Delays are derived at ~343 m/s (2.9 ms per metre).
 */
import type { StemRole } from '../lib/roles'

export interface KitInput {
  /** 1-based interface input number. */
  input: number
  role: StemRole
  mic: string
  placement: string
  /** Interface gain knob position, as the user sets it (0–10). Uncalibrated but stable. */
  level: number
  /** Rough acoustic distance to the snare centre, if known. */
  distanceToSnareM?: number
  /** Rough acoustic distance to the kick beater, if known. */
  distanceToKickM?: number
  notes?: string
}

export interface RoomNotes {
  description: string
  /** Surfaces and conditions the analysis should expect to see in the audio. */
  hazards: string[]
}

export interface KitProfile {
  id: string
  name: string
  interface: string
  room: RoomNotes
  inputs: KitInput[]
  /** Roles that should sit in a fixed time relationship; first is the reference. */
  alignmentReference: StemRole[]
  /** Mic pairs expected to be checked against each other for polarity. */
  polarityPairs: Array<[StemRole, StemRole]>
  /** Mains frequency for the hum check; null until known. */
  mainsHz: 50 | 60 | null
  notes: string[]
}

export const SPEED_OF_SOUND = 343

export const delayMs = (metres: number): number => (metres / SPEED_OF_SOUND) * 1000

const inches = (n: number) => n * 0.0254

/**
 * The user's attic kit: 8 inputs into a Focusrite, no cymbals but hats,
 * one dampened floor tom with no close mic, dry insulated room.
 * Distances are estimates from the written description; refine from photos.
 */
export const ATTIC_KIT: KitProfile = {
  id: 'attic-kit',
  name: 'Attic kit',
  interface: 'Focusrite 8-in',
  room: {
    description:
      'Small insulated attic. Sloped ceiling low over the kit, walls hung with fabric, foil-faced insulation showing in places, rug on a wood floor, window directly behind the kick. Kit is kick, snare, hats and one floor tom.',
    hazards: [
      'Ceiling is close above the overheads: expect a strong early reflection and comb filtering in the OH pair.',
      'Window glass directly behind the kick reflects into the room mic and overheads.',
      'Foil-faced insulation reflects high frequencies even though the room sounds dead.',
      'A mains extension cord runs across the floor alongside the mic cables, near the floor-mounted boundary mic: hum risk.',
      'Room mic is 3 ft in front of the kick, so it behaves as a front-of-kit mono mic rather than ambience.',
    ],
  },
  inputs: [
    {
      input: 1,
      role: 'oh_l',
      mic: 'Telefunken TF-11',
      placement: 'Stereo pair ~28" above the kit, left',
      level: 2,
      distanceToSnareM: inches(30),
      distanceToKickM: inches(42),
    },
    {
      input: 2,
      role: 'oh_r',
      mic: 'Telefunken TF-11',
      placement: 'Stereo pair ~28" above the kit, right',
      level: 2,
      distanceToSnareM: inches(30),
      distanceToKickM: inches(42),
    },
    {
      input: 3,
      role: 'room_mono',
      mic: 'Aston Spirit',
      placement: 'Front of kit at drummer eye level, 36" from the drummer',
      level: 2,
      distanceToSnareM: inches(40),
      distanceToKickM: inches(36),
      notes: 'Room is very dry (insulated attic); behaves more like a front-of-kit mic than an ambient mic.',
    },
    {
      input: 4,
      role: 'kick_out',
      mic: 'Sennheiser boundary condenser',
      placement: 'On the rug about a foot in front of the kick front head, which has a port hole',
      level: 0,
      distanceToKickM: inches(30),
      notes: 'Boundary mic on the floor next to a mains cord; polarity relative to kick in is not obvious, measure it.',
    },
    {
      input: 5,
      role: 'hat',
      mic: 'sE7 pencil condenser',
      placement: 'At the outer edge of the hi-hat, roughly at cymbal height',
      level: 3,
      distanceToSnareM: inches(12),
      notes: 'Expect heavy snare bleed; snare-to-hat delay ~1 ms.',
    },
    {
      input: 6,
      role: 'snare_bottom',
      mic: 'Samson C01 pencil condenser',
      placement: 'On a short stand under the snare, pointing up at the snare wires',
      level: 3,
      distanceToSnareM: inches(4),
      notes: 'Usually needs polarity flipped against snare top.',
    },
    {
      input: 7,
      role: 'snare_top',
      mic: 'Shure SM57',
      placement: 'Clipped at the rim, 2" from the top head, angled at the centre; head is taped and cloth-dampened',
      level: 6,
      distanceToSnareM: inches(2),
    },
    {
      input: 8,
      role: 'kick_in',
      mic: 'Shure Beta 52A',
      placement: 'Inside the kick drum',
      level: 5,
      distanceToKickM: inches(6),
    },
  ],
  alignmentReference: ['oh_l', 'oh_r'],
  polarityPairs: [
    ['snare_top', 'snare_bottom'],
    ['kick_in', 'kick_out'],
    ['oh_l', 'oh_r'],
  ],
  mainsHz: null,
  notes: [
    'Only tom is a floor tom, dampened with a blanket, with no close mic: it lives in the overheads and room.',
    'No cymbals other than hi-hat.',
    'Snare tuned high.',
    'Sample rate unknown; read it from the files.',
  ],
}

export const DEFAULT_KIT: KitProfile = ATTIC_KIT

/** Role for an interface input number, or null if the profile has no such input. */
export function roleForInput(profile: KitProfile, input: number): StemRole | null {
  return profile.inputs.find((i) => i.input === input)?.role ?? null
}

/**
 * Pulls an input/track number out of a generic filename such as
 * "Audio 8.wav", "Track 08_01.wav", "Input 3.wav", "Ch 5.wav" or "8.wav".
 * Returns null for names that carry a real word (those go through the guesser).
 */
export function inputNumberFromName(filename: string): number | null {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase()
  const m = base.match(/^(?:(?:audio|track|trk|input|in|ch|channel|mic)\s*[-_ ]?)?0*(\d{1,2})(?:[-_. ]\d{2,})?$/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}
