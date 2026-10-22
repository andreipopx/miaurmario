import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STINKY_PERSONA,
  cleanStinkyName,
  parsePersonaCookie,
  personaFromProfile,
  personalizeMessages,
  serializePersona,
  stinkyAssetSet,
} from '@/lib/stinky-persona';
import { meows } from '@/lib/meows';
import { stinkyAssetBase, stinkyNeutralStill } from '@/components/stinky/stinky-states';

describe('their own Stinky', () => {
  it('accepts plain names and rejects anything else', () => {
    expect(cleanStinkyName('  Don   Gato ')).toBe('Don Gato');
    expect(cleanStinkyName('Mª José')).toBe('Mª José');
    expect(cleanStinkyName("O'Malley")).toBe("O'Malley");
    expect(cleanStinkyName('x'.repeat(21))).toBeNull();
    expect(cleanStinkyName('Hola {x}')).toBeNull();
    expect(cleanStinkyName('<b>')).toBeNull();
    expect(cleanStinkyName('')).toBeNull();
  });

  it('round-trips the cookie and falls back to Stinky on garbage', () => {
    const chan = { name: 'Chan Chan', coat: 'naranja-atigrado', eyes: 'verde', voice: 'solo-miau' } as const;
    expect(parsePersonaCookie(serializePersona(chan))).toEqual(chan);
    // A cookie from before the voice existed keeps the default voice.
    expect(parsePersonaCookie('negro|azul|Chan')).toEqual({ name: 'Chan', coat: 'negro', eyes: 'azul', voice: 'gato' });
    expect(parsePersonaCookie(undefined)).toEqual(DEFAULT_STINKY_PERSONA);
    expect(parsePersonaCookie('dragon|rojo|%E0%A4%A')).toEqual(DEFAULT_STINKY_PERSONA);
    expect(parsePersonaCookie('siames|natural|Hola%20%7Bx%7D')).toEqual({
      name: 'Stinky',
      coat: 'siames',
      eyes: 'natural',
      voice: 'gato',
    });
  });

  it('reads the profile, defaulting what is missing', () => {
    expect(personaFromProfile({})).toEqual(DEFAULT_STINKY_PERSONA);
    expect(personaFromProfile({ stinky_name: 'Chan', stinky_coat: 'negro', stinky_eyes: 'azul' })).toEqual({
      name: 'Chan',
      coat: 'negro',
      eyes: 'azul',
      voice: 'gato',
    });
    expect(personaFromProfile({ stinky_voice: 'muy-gato' }).voice).toBe('muy-gato');
    expect(personaFromProfile({ stinky_voice: 'ladrido' }).voice).toBe('gato');
  });

  it('meows the same way for the same look, and only meows', () => {
    expect(meows('look-1')).toBe(meows('look-1'));
    expect(meows('look-1').length).toBeGreaterThan(2);
    expect(meows('look-1').toLowerCase()).not.toMatch(/jersey|vaquero|look/);
  });

  it('renames every message but leaves placeholders alone', () => {
    const out = personalizeMessages({ a: 'Habla con Stinky', b: { c: 'Stinky y {name}', d: 'Stinkys' } }, 'Chan');
    expect(out).toEqual({ a: 'Habla con Chan', b: { c: 'Chan y {name}', d: 'Stinkys' } });
  });

  it('picks the right pre-rendered set for coat and eyes', () => {
    expect(stinkyAssetSet('esmoquin')).toBe('esmoquin');
    expect(stinkyAssetSet('esmoquin', 'ambar')).toBe('esmoquin'); // his own eyes
    expect(stinkyAssetSet('esmoquin', 'verde')).toBe('esmoquin--verde');
    expect(stinkyAssetSet('siames', 'azul')).toBe('siames');
    expect(stinkyAssetSet('blanco', 'ambar')).toBe('blanco--ambar');
    expect(stinkyAssetBase()).toBe('/brand/stinky/head');
    expect(stinkyAssetBase('gris', 'verde')).toBe('/brand/coats/gris--verde/head');
    expect(stinkyNeutralStill('dark', { small: true, coat: 'negro' })).toMatch(
      /^\/brand\/coats\/negro\/head\/still\/stinky-neutral-dark-256\.png/
    );
  });
});
