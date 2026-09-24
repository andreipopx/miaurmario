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
en secuencias PNG (en `public/stinky`, no versionadas) para que cada fotograma sea exacto.

Las fuentes (Figtree, Bagel Fat One) van en `public/fonts`, así el render no depende de red.
Si Remotion no encuentra Chrome, pásale uno: `--browser-executable=/ruta/a/chrome`.

El vídeo no lleva audio: añade la música en la propia app (Instagram/TikTok) para usar
sonidos en tendencia.
