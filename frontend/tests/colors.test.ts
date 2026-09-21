import { describe, expect, it } from 'vitest'

import {
  COLOR_PRESETS,
  ciede2000,
  hexToRgb,
  hslToRgb,
  isLightColor,
  nearestClothingColor,
  rgbToHex,
  rgbToLab,
} from '@/lib/colors'
import { CLOTHING_COLORS } from '@/lib/types'
import es from '@/messages/es.json'
import en from '@/messages/en.json'

describe('colour maths', () => {
  it('round-trips hex and rgb', () => {
    expect(hexToRgb('#1B2A4A')).toEqual({ r: 27, g: 42, b: 74 })
    expect(hexToRgb('fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(rgbToHex({ r: 27, g: 42, b: 74 })).toBe('#1b2a4a')
    expect(() => hexToRgb('#12')).toThrow()
  })

  it('converts HSL to RGB', () => {
    expect(rgbToHex(hslToRgb(0, 1, 0.5))).toBe('#ff0000')
    expect(rgbToHex(hslToRgb(120, 1, 0.5))).toBe('#00ff00')
    expect(rgbToHex(hslToRgb(240, 1, 0.25))).toBe('#000080')
    expect(rgbToHex(hslToRgb(0, 0, 1))).toBe('#ffffff')
  })

  it('computes Lab for white and black', () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 })
    expect(white.L).toBeCloseTo(100, 1)
    expect(Math.abs(white.a)).toBeLessThan(0.01)
    const black = rgbToLab({ r: 0, g: 0, b: 0 })
    expect(black.L).toBeCloseTo(0, 5)
  })

  it('matches the CIEDE2000 reference pairs (Sharma et al. 2005)', () => {
    // Pairs 1, 7 and 17 of the published test data.
    expect(ciede2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3)
    expect(ciede2000({ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 })).toBeCloseTo(2.3669, 3)
    expect(ciede2000({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 })).toBeCloseTo(27.1492, 3)
    expect(ciede2000({ L: 60, a: 10, b: 10 }, { L: 60, a: 10, b: 10 })).toBe(0)
  })
})

describe('nearestClothingColor', () => {
  it('returns every palette colour for its own swatch', () => {
    for (const c of CLOTHING_COLORS) {
      expect(nearestClothingColor(c.hex)).toBe(c.value)
    }
  })

  it('snaps wheel picks to sensible families', () => {
    expect(nearestClothingColor('#000000')).toBe('black')
    expect(nearestClothingColor('#ffffff')).toBe('white')
    expect(nearestClothingColor('#0a1f5c')).toBe('navy')
    expect(nearestClothingColor('#ff0000')).toBe('red')
    expect(nearestClothingColor('#f4b6c8')).toBe('pink')
    expect(nearestClothingColor('#c19a6b')).toBe('tan') // "camel"
    expect(nearestClothingColor('#800020')).toBe('burgundy')
    expect(nearestClothingColor('#ff8c00')).toBe('orange')
    // Vivid wheel picks land on their own family, not on a muted neighbour.
    expect(nearestClothingColor('#33d633')).toBe('green')
    expect(nearestClothingColor('#0066ff')).toBe('blue')
    expect(nearestClothingColor('#ffff33')).toBe('yellow')
    expect(nearestClothingColor('#cc33ff')).toBe('purple')
    expect(nearestClothingColor('#33cccc')).toBe('teal')
  })
})

describe('presets and labels', () => {
  const values = new Set<string>(CLOTHING_COLORS.map((c) => c.value))

  it('presets only use named palette colours', () => {
    expect(COLOR_PRESETS.map((p) => p.id)).toEqual(['earth', 'pastel', 'mono', 'neutrals', 'neon', 'jewel'])
    for (const preset of COLOR_PRESETS) {
      expect(preset.colors.length).toBeGreaterThanOrEqual(3)
      for (const c of preset.colors) expect(values.has(c)).toBe(true)
      expect(es.colorPicker.presetNames[preset.id as keyof typeof es.colorPicker.presetNames]).toBeTruthy()
      expect(en.colorPicker.presetNames[preset.id as keyof typeof en.colorPicker.presetNames]).toBeTruthy()
    }
  })

  it('every palette colour has a Spanish and English label', () => {
    for (const c of CLOTHING_COLORS) {
      expect(es.tagValues.colors[c.value as keyof typeof es.tagValues.colors]).toBeTruthy()
      expect(en.tagValues.colors[c.value as keyof typeof en.tagValues.colors]).toBeTruthy()
    }
    expect(es.tagValues.colors.tan).toBe('Camel')
    expect(es.tagValues.materials.leather).toBe('Cuero')
  })

  it('picks readable glyph colours', () => {
    expect(isLightColor('#FAFAFA')).toBe(true)
    expect(isLightColor('#1a1a1a')).toBe(false)
    expect(isLightColor('nope')).toBe(false)
  })
})
