import { describe, expect, it } from 'vitest'
import { assignRoles, guessRole, roleOptions, tokenize } from './roles'

describe('tokenize', () => {
  it('strips extension, take numbers and leading track numbers', () => {
    expect(tokenize('03 Kick In_01.wav')).toEqual(['kick', 'in'])
    expect(tokenize('Snare Top.02.wav')).toEqual(['snare', 'top'])
    expect(tokenize('Tom 2.wav')).toEqual(['tom', '2'])
    expect(tokenize('OH1.wav')).toEqual(['oh', '1'])
    expect(tokenize('OHL.wav')).toEqual(['oh', 'l'])
    expect(tokenize('KickOut.wav')).toEqual(['kick', 'out'])
    expect(tokenize('takes/Take 3/SnrBot.wav')).toEqual(['snr', 'bot'])
  })
})

describe('guessRole', () => {
  const cases: Array<[string, string]> = [
    ['Kick In.wav', 'kick_in'],
    ['Kick.wav', 'kick_in'],
    ['KICK OUT.wav', 'kick_out'],
    ['Kick Sub.wav', 'kick_out'],
    ['BD_in.wav', 'kick_in'],
    ['Snare Top.wav', 'snare_top'],
    ['Snare.wav', 'snare_top'],
    ['Snare Bottom.wav', 'snare_bottom'],
    ['SN BTM.wav', 'snare_bottom'],
    ['Snare B.wav', 'snare_bottom'],
    ['Hi Hat.wav', 'hat'],
    ['HH.wav', 'hat'],
    ['HiHat.wav', 'hat'],
    ['Tom 1.wav', 'tom_1'],
    ['Tom2.wav', 'tom_2'],
    ['Rack Tom.wav', 'tom_1'],
    ['Floor Tom.wav', 'tom_3'],
    ['Floor 2.wav', 'tom_4'],
    ['OH L.wav', 'oh_l'],
    ['OH R.wav', 'oh_r'],
    ['Overhead Left.wav', 'oh_l'],
    ['OH_R.wav', 'oh_r'],
    ['OH1.wav', 'oh_l'],
    ['OH2.wav', 'oh_r'],
    ['OH Mono.wav', 'oh_mono'],
    ['OH.wav', 'oh_mono'],
    ['Room L.wav', 'room_l'],
    ['RoomR.wav', 'room_r'],
    ['Room.wav', 'room_mono'],
    ['Mono Room.wav', 'room_mono'],
    ['Crush.wav', 'room_mono'],
    ['Ride.wav', 'other'],
    ['Click.wav', 'other'],
    ['Audio 7.wav', 'other'],
  ]
  for (const [name, role] of cases) {
    it(`${name} → ${role}`, () => {
      expect(guessRole(name)).toBe(role)
    })
  }
})

describe('assignRoles', () => {
  it('compacts tom numbers in order of guessed position', () => {
    expect(assignRoles(['Rack.wav', 'Floor.wav'])).toEqual(['tom_1', 'tom_2'])
    expect(assignRoles(['Floor.wav', 'Rack.wav'])).toEqual(['tom_2', 'tom_1'])
    expect(assignRoles(['Tom 1.wav', 'Tom 2.wav', 'Floor 1.wav', 'Floor 2.wav'])).toEqual([
      'tom_1',
      'tom_2',
      'tom_3',
      'tom_4',
    ])
    expect(assignRoles(['Hi Tom.wav', 'Mid Tom.wav', 'Low Tom.wav'])).toEqual([
      'tom_1',
      'tom_2',
      'tom_3',
    ])
  })

  it('leaves non-tom roles alone', () => {
    expect(assignRoles(['Kick In.wav', 'Tom 3.wav', 'OH L.wav'])).toEqual([
      'kick_in',
      'tom_1',
      'oh_l',
    ])
  })
})

describe('roleOptions', () => {
  it('offers at least four toms and one past the highest in use', () => {
    expect(roleOptions().filter((r) => r.startsWith('tom_'))).toHaveLength(4)
    expect(roleOptions(['tom_6', 'kick_in']).filter((r) => r.startsWith('tom_'))).toHaveLength(7)
  })
})
