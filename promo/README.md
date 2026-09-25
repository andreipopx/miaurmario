# Miaurmario — vídeos promo

Vídeo vertical (1080×1920, 30 fps, ~30 s) para Reels / TikTok / Shorts, hecho con
[Remotion](https://www.remotion.dev/). Recrea la interfaz "Stinky pop" (tokens de
`frontend/app/globals.css`) y anima a Stinky con sus propios clips.

Escenas (`src/scenes/`): gancho → marca → foto + etiquetado IA → armario →
El Estilista → chat con Stinky → amigos → cierre con la URL.

```bash
cd promo
npm install
npm run studio   # editor en el navegador, con timeline
npm run render   # → out/miaurmario-promo.mp4
```

`npm run assets` convierte los WebP animados de `frontend/public/brand/stinky/head/anim`
en secuencias PNG (en `public/stinky`) para que cada fotograma sea exacto, y sintetiza el
audio (en `public/audio`). Ninguno de los dos se versiona.

Las fuentes (Figtree, Bagel Fat One) van en `public/fonts`, así el render no depende de red.
Si Remotion no encuentra Chrome, pásale uno: `--browser-executable=/ruta/a/chrome`.

## Sonido

`scripts/make-audio.mjs` genera todo el audio por síntesis (osciladores y ruido, sin
samples, así que no hay derechos de autor): una base pop a 120 BPM en Do mayor
(I–V–vi–IV) cuyo primer tiempo fuerte cae cuando aparece Stinky (fotograma 86), más
efectos de interfaz (pop, whoosh, disparador, teclas, campanita, corazón…).
`src/Soundtrack.tsx` coloca cada efecto en el fotograma de su animación, usando las
constantes de tiempo que exporta cada escena.

Si quieres usar un sonido en tendencia en Instagram/TikTok, baja el volumen del audio
original en la app o quita `<Soundtrack />` de `src/Root.tsx`.

## Vídeo 2: "¿Es una app?" (`WebPromo`)

Explica que Miaurmario es una web (se abre en el navegador, se instala desde
Compartir → Añadir a pantalla de inicio, funciona en móvil y ordenador) y enseña la
música: conectar Spotify/Last.fm y una escena por canción con su mood y su outfit
(`src/web/songs.ts`).

Las canciones **no están en git** (copyright): pon los MP3 en `public/music/` con los
nombres de `src/web/songs.ts` (`lana-doin-time.mp3`, `barry-b-carolina-durante.mp3`,
`bad-bunny-eoo.mp3`).

```bash
npx remotion render WebPromo out/miaurmario-web-canciones.mp4
npx remotion render WebPromo out/miaurmario-web-sin-musica.mp4 --props='{"withMusic":false}'
```

La versión sin música lleva solo los efectos, para subirla con el audio de la
biblioteca de Instagram/TikTok si la plataforma silencia la otra.
