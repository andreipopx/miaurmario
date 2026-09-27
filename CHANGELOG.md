# Changelog

Notable changes to **Miaurmario**.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are the dates the work landed on `main` in this repository.

Miaurmario has never cut a tagged release. There are no version numbers below
the fork point, only dated batches of work, because that is what actually
happened. The version numbers in the upstream section belong to the project this
one was forked from and are kept for provenance, not continuity — Miaurmario did
not inherit `1.5.1` and is not `1.5.2`.

---

## Miaurmario (this fork)

Forked on **2026-07-21** from [Anyesh/wardrowbe](https://github.com/Anyesh/wardrowbe)
at upstream `1.5.1`, and since rewritten into a different product: a Spanish-first
wardrobe PWA with a cat stylist.

### 2026-09-26 — Garment photos you can actually fix

- **Front and back photos.** Every photo on a garment knows which side it shows
  (`delante` / `detrás`); a photo can be merged into an existing garment as its
  back.
- **Cut-outs that respect holes the fabric encloses** — a bag handle, the gap
  between an arm and the body. Switched the default rembg model to
  `isnet-general-use` and documented, rather than hid, the case it still misses
  (a small halter neckline).
- **Eraser** (`borra lo que sobra`): erase/restore brushes that edit the stored
  alpha, zoom, whole-hole fill, undo per stroke, and a return to the automatic
  cut-out. Works on garments whose background was never removed, so cut-outs no
  longer depend on AI being available.
- **Layering as a first-class idea**: a dress over trousers is a look, not a
  mistake — in the flat lay, in the stylist, and as a taste preference
  («Me gusta superponer prendas»).
- **Tag vocabulary in the Spanish people actually speak**: tappable subtypes, and
  quick-tag buttons drawn from the garments already in that wardrobe.
- Garment detail reduced to two buttons plus «más opciones», with the photo tools
  behind the pencil; thumbnail framing is saved; hats are sized like hats.
- Fixed: the bulk review pass silently losing edits it said it had saved; the
  wardrobe filter badge counting something other than what "clear" clears; a
  saved rotation persisting on the preview.

### 2026-09-25 — Bulk intake, colour and wear

- **Batch uploader with a resumable queue** and a quick review pass over the
  whole batch.
- **Photo tools on intake**: straighten and crop, store the photo the user took
  rather than the one the sensor saw, and pick the garment's colour by pointing
  at it — the real shade is kept beside the colour family.
- **Wear stats**: «Cuánto la usas» on each garment and «Tu armario en números»,
  counting what gets worn and surfacing what does not.
- **Outfits as flat lays** rather than four thumbnails, each garment sitting on a
  whisper of its own colour.
- **Automatic location** at city precision only (city + IANA timezone).
- **Two daily alerts** — the morning look and the friend-activity digest —
  switchable from Ajustes → Notificaciones.
- Integrations page reordered to put Last.fm first and be honest about the state
  of the other two; a way to ask the admin for a Spotify seat.
- `Familia` hidden from the nav now that `Amigos` is the social layer.

### 2026-09-24 — Landing page

- `/` became a real landing page, with four screenshots of the running app.

### 2026-09-23 — Stinky gets a voice, a memory and a taste profile

- **Stinky's own cat voice** across the app, and a warmer stylist that deflects
  lightly instead of refusing.
- **Per-user memory Stinky writes himself**, fed back into his prompts.
- **«Qué llevo puesto»**: read an outfit off a selfie and match it against the
  wardrobe.
- **«Tu estilo con Stinky»**: an illustrated swipe deck that captures a taste
  profile, an editor for it in Ajustes, and the profile wired into the stylist.
- **Easy intake**: share a photo into the app, paste a shop link, or scan a care
  label.
- Haptics were added and then reverted — they did not survive contact with iOS.

### 2026-09-22 — Several looks a day, push, and the waitlist

- **«Tu día» / momentos del día**: several looks for one day with suggested
  transitions between them, on Hoy and in the API.
- **Notifications**: email by default, plus a Web Push channel with per-event
  settings and an install guide.
- **Closed-beta waitlist**: access requests email (and push) the site admins.
- **Last.fm** as a music source, behind a source-agnostic Música tab.
- **Profile photos** with circle crop and EXIF stripping.
- Navigation simplified to five areas with in-section tabs.
- PWA: iOS splash screens, `viewport-fit=cover`, standalone polish on iOS and
  Android, and a service worker that stops serving itself from cache.
- A responsive pass: nothing overflows sideways at 320 px with large fonts,
  with a Playwright audit script to keep it that way.
- Onboarding: a welcome tour with Stinky, a first-garment card on Hoy, one-time
  area tips.

### 2026-09-21 — The big one: Stinky, friends, music, admin

- **Stinky pop design system**: Figtree + Bagel Fat One, pill UI, floating glass
  dock, the mascot built from photographs of the real cat, and every screen
  restyled. Tokens live in CSS variables, so a palette swap is one file.
- **«Habla con Stinky»**: a streaming chat with wardrobe tools, a per-tool-loop
  cap, and per-user isolation; outfits saved from chat carry a `stinky_chat`
  source.
- **Amigos**: friendships by handle, per-outfit visibility (private · friends ·
  public), a feed grouped per friend and day, «me encanta» and comments, an
  in-app badge and a `/u/{username}` invite page. Friends never get session
  access to another user's image folder.
- **Música**: Spotify listening history and a daily listening mood, now-playing,
  mood timeline, tops and history, plus exact-track song input for the stylist.
- **AI access modes**: `none`, granted by the admin, or bring-your-own-key, with
  per-user prompt/completion token accounting and friendly no-AI notices
  wherever an AI feature would have run.
- **Admin panel**: Resumen, Usuarios, Registro, Buzón, Sistema — audit log, app
  settings, invites, a feedback inbox, announcements and a GDPR deletion job.
- **Invite-only sign-up**, enforced on every account-creation path, with no email
  enumeration.
- **Optional password login** (argon2) alongside the magic link, sliding token
  refresh, and a Seguridad settings page.
- City search, reverse geocoding and IANA timezone validation (legacy browser
  timezone ids are mapped forward).
- Public privacy policy and terms at `/legal`.
- Branded Miaurmario email templates.
- AI tag values shown in Spanish across wardrobe, outfits and insights.

### 2026-08-15 — Auth and Pinterest

- Security-headers middleware.
- **Magic-link sign-in**, usernames, and admin promotion.
- **Pinterest integration**: OAuth, import and a cron refresh. The Pinterest app
  is still awaiting API approval, so the page is status-driven and says so.

### 2026-07-21 → 2026-07-23 — The rebrand

- Installable PWA target and a Spanish i18n scaffold, then full Spanish
  coverage; `es` is the default locale, resolved from a cookie with no
  `Accept-Language` sniffing.
- Rebranded to Miaurmario. (The first pass was an editorial Playfair aesthetic;
  it was replaced wholesale by Stinky pop in September.)
- Music-based mood input for the stylist.
- Free-form drag-and-drop canvas in the outfit Studio — see
  [`docs/outfit-builder.md`](docs/outfit-builder.md).
- Dual-origin serving (LAN + Cloudflare Tunnel).

---

## Upstream history — Anyesh/wardrowbe, up to 1.5.1

This section is **not** Miaurmario's history. It is the release history of the
project this one was forked from, kept so the provenance of the code is clear.
The full entries, with links to the commits and pull requests they refer to,
live in that project's own changelog:
[Anyesh/wardrowbe](https://github.com/Anyesh/wardrowbe).

| Version | Date | Headline |
| --- | --- | --- |
| 1.5.1 | 2026-07-17 | Backend URL resolution and prod compose fixes |
| 1.5.0 | 2026-07-16 | Bulk upload without forced AI analysis, page-size control, PUID/PGID overrides, undo background removal |
| 1.4.0 | 2026-07-01 | Internal AI made optional, `/capabilities` endpoint, weather location fallbacks |
| 1.3.1 | 2026-06-26 | OIDC fixes; Docker images published to GHCR |
| 1.3.0 | 2026-05-31 | Mobile callback, outfit studio and recommendation-engine fixes |
| 1.2.4 | 2026-04-17 | Pairing slot fixes, socks/tie types |
| 1.2.3 | 2026-03-30 | Separate test database instead of falling back to production |
| 1.2.2 | 2026-03-20 | Dev credential login in production builds, better diagnose errors |
| 1.2.1 | 2026-02-20 | Type and lint cleanups across the open-sourced repo |
| 1.2.0 | 2026-02-06 | Wash tracking, multi-image items, family outfit ratings, wear statistics, wardrobe sorting/filtering |
| 1.1.0 | 2026-01-30 | AI learning system, "wore instead" tracking, learning insights dashboard |
| 1.0.0 | 2026-01-25 | First release: photo wardrobe, AI tagging, outfit recommendations, notifications, analytics, Docker and Kubernetes deployment |

Some of that still runs. Wash tracking, the learning system, the pairing engine,
the analytics and the Kubernetes manifests are inherited and largely untouched by
this fork; the family feature is present in the code but hidden from the
navigation, because `Amigos` replaced it.
