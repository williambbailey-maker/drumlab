import { describe, expect, it } from 'vitest'
import {
  NO_KIT,
  SEPTEMBER_2026_KIT,
  delayMs,
  expectedLeadsMs,
  inputNumberFromName,
  kitById,
  roleForInput,
} from './profile'

describe('inputNumberFromName', () => {
  it('reads generic DAW track names', () => {
    expect(inputNumberFromName('Audio 8.wav')).toBe(8)
    expect(inputNumberFromName('Audio 8-01.wav')).toBe(8)
    expect(inputNumberFromName('Track 03_02.wav')).toBe(3)
    expect(inputNumberFromName('Input 1.wav')).toBe(1)
    expect(inputNumberFromName('ch5.wav')).toBe(5)
    expect(inputNumberFromName('07.wav')).toBe(7)
  })
  it('ignores names that carry a real word', () => {
    expect(inputNumberFromName('Kick In.wav')).toBeNull()
    expect(inputNumberFromName('Snare 2.wav')).toBeNull()
    expect(inputNumberFromName('Ride.wav')).toBeNull()
  })
})

describe('kitById', () => {
  it('falls back to the default for unknown ids', () => {
    expect(kitById('nope').id).toBe('september-2026-drum-config')
    expect(kitById('none').name).toBe('No profile')
  })
})

describe('expectedLeadsMs', () => {
  it('derives per-role leads from the profile distances', () => {
    const leads = expectedLeadsMs(SEPTEMBER_2026_KIT)
    expect(leads.snare_top).toBeGreaterThan(1.5)
    expect(leads.snare_top).toBeLessThan(2.5)
    expect(leads.kick_in).toBeGreaterThan(2)
    expect(leads.room_mono).toBeLessThan(0)
    expect(leads.oh_l).toBeUndefined()
  })
  it('is empty without an overhead', () => {
    expect(expectedLeadsMs(NO_KIT)).toEqual({})
  })
})

describe('SEPTEMBER_2026_KIT', () => {
  it('maps all eight inputs to distinct roles', () => {
    const roles = SEPTEMBER_2026_KIT.inputs.map((i) => i.role)
    expect(roles).toHaveLength(8)
    expect(new Set(roles).size).toBe(8)
    expect(roleForInput(SEPTEMBER_2026_KIT, 7)).toBe('snare_top')
    expect(roleForInput(SEPTEMBER_2026_KIT, 9)).toBeNull()
  })
  it('puts the overheads about 2 ms behind the snare top', () => {
    const oh = SEPTEMBER_2026_KIT.inputs.find((i) => i.role === 'oh_l')!
    const top = SEPTEMBER_2026_KIT.inputs.find((i) => i.role === 'snare_top')!
    const ms = delayMs(oh.distanceToSnareM! - top.distanceToSnareM!)
    expect(ms).toBeGreaterThan(1.5)
    expect(ms).toBeLessThan(2.5)
  })
})
