# Miaurmario — vídeo promo

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
