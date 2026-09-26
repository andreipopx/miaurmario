# Miaurmario — "Stinky pop" design system

Playful, mobile-first, Whering-inspired: a white canvas, light-gray panels behind garments,
ink text, pill buttons, simple line icons, and saturated colour blocks taken from Stinky the
cat (pink nose, amber eyes) plus sky and mint. Colour is for **surfaces** (quick-action tiles,
active states, badges, avatars) — never for body text.

Everything is driven by CSS variables in `app/globals.css`, mapped to Tailwind in
`tailwind.config.js`. Swapping the palette is a one-file change.

## Palette

| Token (CSS var) | Tailwind | Light | Dark | Use |
|---|---|---|---|---|
| `--background` | `bg-background` | `#FFFFFF` | `#0F0F0F` | Page background |
| `--panel` / `--muted` | `bg-panel`, `bg-muted` | `#F4F4F2` | `#1C1C1C` | Gray surfaces: garment tiles, search field, "Tu look de hoy" panel |
| `--card` | `bg-card` | `#FFFFFF` | `#161616` | Hairline cards |
| `--border` | `border-border` | `#ECECEC` | `#2A2A2A` | Hairlines |
| `--foreground` | `text-foreground` | `#111111` ink | `#F5F5F5` | Text, icons |
| `--muted-foreground` | `text-muted-foreground` | `#6B6B6B` (5.3:1 on white) | `#A3A3A3` | Secondary text |
| `--primary` | `bg-primary` | `#111111` | `#F5F5F5` | Primary CTA (ink pill, inverse in dark) |
| `--secondary` | `bg-secondary` | `#F4F4F2` | `#262626` | Secondary CTA (gray pill) |
| `--signature` | `bg-signature` | `#FF7EB6` bubblegum pink | same | Active tab/day, "Añadir", highlights |
| `--signature-soft` | `bg-signature-soft` | `#FFE3EF` | `#3A1F2C` | Tinted backgrounds, Stinky circles |
| `--pop-amber` | `bg-pop-amber` | `#FFB81C` | same | Quick action / category |
| `--pop-pink` | `bg-pop-pink` | `#FF7EB6` | same | Quick action / category |
| `--pop-sky` | `bg-pop-sky` | `#56C2FF` | same | Quick action / category, "Lavar" badge |
| `--pop-mint` | `bg-pop-mint` | `#3FD99A` | same | Quick action / category |
| `--destructive` | `bg-destructive`, `text-destructive` | `#D92D3A` | `#F0525E` | Errors, delete |
| `--success` / `--warning` | `text-success`, `text-warning` | `#13804F` / `#A35A00` | mint / amber | Text-safe status colours |
| `--ring` | `ring-ring` | ink | pink | Focus rings |

**Rules**
- Pink and the pop colours always carry **ink** (`#111`) text and icons (`text-signature-foreground`,
  `text-pop-foreground`). Never put pink text on white — it fails contrast.
- Primary CTA ("Me lo pongo", "Enviarme el enlace") = `<Button>` (ink pill). Secondary ("Otra idea")
  = `<Button variant="secondary">` (gray pill). Pink highlight = `<Button variant="signature">`.
- Assign pop colours to categories/occasions in the fixed order amber → sky → pink → mint
  (`popColorAt(i)` in `components/chip.tsx`).

## Typography

| Family | Variable | Class | When |
|---|---|---|---|
| Figtree 400–800 | `--font-sans` | default (`font-sans`) | Everything |
| Bagel Fat One | `--font-wordmark` | `font-wordmark` / `<Wordmark />` | **Only** the "miaurmario" logo |

- Page titles: `text-[28px] sm:text-3xl font-extrabold tracking-[-0.02em]` (use `<PageHeader>`).
- Section titles: `text-[15px]`–`text-lg font-bold`.
- `h1–h3` default to weight 800 and −0.02em tracking; `h4–h6` 700.
- Small labels: `.eyebrow` (13px, 600, muted, sentence case). No uppercase-tracked labels.

## Radii

| What | Class | Value |
|---|---|---|
| Cards, panels, dialogs | `rounded-lg` | 24px (`--radius`) |
| Garment tiles | `rounded-tile` | 18px |
| Quick-action tiles | `rounded-quick` | 16px |
| Buttons, inputs, chips, badges, dock | `rounded-full` | pill |
| Small inner bits (select items, checkboxes) | `rounded-md` / `rounded-sm` | 14px / 10px |

No 0-radius corners anywhere.

## Components

`components/ui/*` (shadcn-style) inherit the tokens:

- **Button** — `default` ink pill · `secondary` gray pill · `signature` pink pill · `outline` white pill
  with hairline · `ghost` · `link` · `destructive`. Sizes: `sm` 36px, `default` 44px, `lg` 52px, `icon` 44×44.
- **Input** — 48px white pill, 1.5px hairline; focus = ink border + soft pink ring. For a gray search
  field add `bg-panel border-transparent`.
- **Card** — white, hairline, 24px. For gray panels: `className="bg-panel border-0"`.
- **Badge** — pill; `signature`, `amber`, `sky`, `mint`, `secondary`, `outline`, `destructive`.
- **Alert** — rounded tinted panel (`default` gray, `signature` soft pink, `destructive`).
- **Dialog / AlertDialog** — 24px rounded, no border, soft shadow, round gray close button.
- **Tabs** — pill segmented control on panel gray. **Switch** pink when on. **Progress / Slider** pink fill.

App-level building blocks:

- `components/page-header.tsx` — `<PageHeader title description action />`.
- `components/chip.tsx` — `<Chip active dot="amber" activeStyle="ink|pop">` pill filter chip with a colour dot.
- `components/empty-state.tsx` — `<EmptyState state="sleepy|sad" title description action />`
  (Stinky in a soft-pink circle).
- `components/stinky-tip.tsx` — `<StinkyTip>` "Stinky: …" bubble.
- `components/brand/wordmark.tsx`, `components/brand/stinky-avatar.tsx` (static head in a circle).
- `components/stinky/stinky.tsx` — animated mascot. States: `idle`, `thinking` (stylist generating),
  `happy` (look accepted), `wave` (login/onboarding), `sleepy` (empty states), `sad` (errors).
  Picks the `-dark` assets automatically and honours `prefers-reduced-motion`.

## Layout

- **Mobile (default)**: sticky header (Stinky avatar → profile menu · greeting/wordmark · bell), content
  with `px-4`, and a **floating glass dock** (`components/mobile-nav.tsx`): fixed, 16px side inset,
  24px + safe-area from the bottom, 64px tall, radius 32, `.glass-dock` surface. Active tab = pink
  pill with icon + label; inactive = icon only with `aria-label`. `<main>` uses `.pb-dock` so the
  dock never covers content.
- **Desktop (lg+)**: 256px white sidebar with the wordmark and pill nav rows (active = pink),
  content centred at `max-w-6xl`.

## Layers (z-index)

One scale, named. Tokens live in `app/globals.css` (`--z-*`) and are mapped to Tailwind classes in
`tailwind.config.js`, so you write `z-dock`, `z-modal`, … and never `z-[57]`.

| Class | Value | What lives there |
| --- | --- | --- |
| `z-page` | 30 | fixed strips that must slide **under** the header: pull-to-refresh spinner, a page's own filter bar |
| `z-header` | 40 | the app header, and the gradient fade behind the dock |
| `z-dock` | 50 | mobile dock, desktop sidebar |
| `z-float` | 60 | pills floating over the dock's area: bulk-action toolbar + pagination, offline indicator, chat composer |
| `z-status` | 70 | background-upload status bar — above all page furniture, so nothing on the page can hide it |
| `z-drawer` | 80 | mobile nav drawer and its scrim |
| `z-modal` | 90 | dialogs, sheets, feature tour, style quiz (overlay **and** content) |
| `z-popover` | 100 | menus, selects, tooltips, comboboxes — they can open from inside a modal |
| `z-lightbox` | 110 | `yet-another-react-lightbox` (via `--yarl__portal_zindex`) |
| `z-toast` | 120 | sonner (its own default is 999999999; we pin it here) |

A raw `z-10` / `z-20` is still right for stacking **inside** one component's box: a badge on a tile,
a veil over a card, a dropdown under its input, the flat-lay stacking garments by data. Anything
`fixed` or portalled — anything that can land on top of another part of the app — takes a name.

**Bottom slots.** Three things want the space above the dock, so they queue instead of overlapping:
the dock itself, then `bottom-float-1` (`--float-slot-1`, 6.25rem + safe area: bulk-action toolbar
and pagination, offline indicator), then `bottom-float-2` (one 4.25rem slot higher: the upload status
bar). Whatever sits in slot 2 also sets `--float-extra`, which `.pb-dock` adds to its bottom padding
so the extra pill never comes to rest on the last row of a grid. Slot heights are in `rem`, so they
still clear their neighbour at 125% font size.

## Accessibility

- Touch targets ≥ 44px (`h-11`, `min-h-[44px]`).
- Icon-only buttons/links need `aria-label`; toggle chips use `aria-pressed`; the current tab uses
  `aria-current="page"`.
- Focus: `focus-visible:ring-2 ring-ring ring-offset-2` (ink in light, pink in dark).
- Text contrast ≥ 4.5:1 — use `text-foreground` / `text-muted-foreground`; `text-success` /
  `text-warning` are the text-safe status colours.

## Iconography & motion

Lucide line icons, stroke 1.75 (2 when active), `currentColor`. Motion is quick and friendly:
150–200ms, `ease-pop` for springy UI (dock pill), `active:scale-[0.97]` on buttons.

## Assets

- `public/brand/stinky/head/` — mascot (animated WebP per state, poster SVG/PNG, static head SVG).
- `public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, `favicon-32.png` — Stinky head, **generated**: run `npm run icons`
  (`scripts/generate-icons.mjs`, uses sharp) whenever `public/brand/stinky/head/stinky-head.svg` changes.
  The script measures the head's bounding box itself, so new art needs no tweaks. Then bump `CACHE` in
  `public/sw.js` so installed PWAs refresh.
- Never hardcode the cat's colours in CSS/TSX; UI chrome uses the system tokens (ink, pink, panel).
- `public/manifest.webmanifest` — `theme_color #FF7EB6`, `background_color #FFFFFF`.
