import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import es from '@/messages/es.json'
import en from '@/messages/en.json'
import { CLOTHING_TYPES } from '@/lib/types'

/**
 * `item.type` is an English slug — it is the data contract with the tagger and
 * the scorer, not a word for a Spanish-speaking owner to read. The app once
 * printed "t-shirt", "jeans", "sneakers" and "hat" straight onto the screen.
 *
 * This spec is the guard: anywhere a `.type` reaches a display position (JSX
 * text, `alt`, `title`, `aria-label`) it must go through one of the label
 * helpers. Adding a new screen that prints a raw slug fails here.
 */

const ROOT = join(__dirname, '..')

/** The helpers that turn a tag value into a label the owner can read. */
const LABEL_HELPERS = [
  'typeLabel(',
  "tagLabel('types'",
  'tagLabel("types"',
  'garmentWord(',
  'label(',
  'labelOf(',
]

/**
 * The add / photo-review flow is specced by its own suites (bulk-upload,
 * easy-intake) and is being reworked in parallel; it already routes every type
 * through `tagLabel`.
 */
const SKIPPED_DIRS = ['components/bulk-upload', 'components/add-item', 'node_modules', '.next']

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(ROOT, full)
    if (SKIPPED_DIRS.some((skip) => rel === skip || rel.startsWith(skip + '/'))) continue
    if (statSync(full).isDirectory()) tsxFiles(full, out)
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** A line that shows something, rather than one that compares or assigns. */
const DISPLAY_POSITION = /(\balt=|\baria-label=|\btitle=|^\s*\{|>\s*\{)/
const TOUCHES_TYPE = /\.type\b/
// `type.type`, `ct.type`, `ty.value`: a count row's own field, never a garment.
const IS_COMPARISON = /\.type\s*(===|!==|\?\?=|=[^=])|\.type\s*\)\s*\?/

function showsRawType(line: string): boolean {
  // A message key like t('form.type') is not a garment; drop string literals
  // before looking for a `.type` the code actually reads.
  const code = line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  if (!TOUCHES_TYPE.test(code)) return false
  if (!DISPLAY_POSITION.test(code)) return false
  if (IS_COMPARISON.test(code)) return false
  return !LABEL_HELPERS.some((helper) => line.includes(helper))
}

describe('no raw garment slug reaches the screen', () => {
  it('recognises the shapes the bug took', () => {
    // Each of these was on screen before this branch.
    expect(showsRawType('              {item.type}')).toBe(true)
    expect(showsRawType('                    alt={item.name || item.type}')).toBe(true)
    expect(showsRawType('      aria-label={item.name ?? item.type}')).toBe(true)
    expect(showsRawType('                    title={previewItem?.type}')).toBe(true)
    expect(showsRawType('<p>{item.name || typeLabel(item.type)}</p>')).toBe(false)
    expect(showsRawType("  alt={item.name || tagLabel('types', item.type)}")).toBe(false)
    expect(showsRawType("  <Label>{t('form.type')}</Label>")).toBe(false)
    expect(showsRawType('  if (draft.type === current.type) return')).toBe(false)
  })

  it('routes every displayed item.type through a label helper', () => {
    const offenders: string[] = []
    for (const file of [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))]) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (showsRawType(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`)
        })
    }
    expect(offenders, `raw garment slugs rendered:\n${offenders.join('\n')}`).toEqual([])
  })

  it('translates the whole type vocabulary in both locales', () => {
    for (const { value } of CLOTHING_TYPES) {
      expect(es.clothingTypes, value).toHaveProperty(value)
      expect(en.clothingTypes, value).toHaveProperty(value)
    }
  })

  it('keeps es and en in step on the flat lay strings', () => {
    expect(Object.keys(es.flatLay).sort()).toEqual(Object.keys(en.flatLay).sort())
  })
})
