/**
 * The scenes we photograph, each mounting the real component.
 *
 * `?scene=` picks one, `?dark=1` and `?font=125` set the conditions the brief asks
 * for. Everything below the scene switch is scaffolding — a panel, a caption — so
 * that what is in the picture is the component and not a page we invented.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';

import '@/app/globals.css';

import es from '@/messages/es.json';
import { AlphaBrush } from '@/components/shared/alpha-brush';
import { GarmentThumb } from '@/components/bulk-upload/garment-thumb';
import { garmentFrameStyle } from '@/lib/garment-framing';
import { garmentTileTint } from '@/lib/garment-tint';
import { cn } from '@/lib/utils';

const params = new URLSearchParams(window.location.search);
const scene = params.get('scene') || 'eraser';
const dark = params.get('dark') === '1';
const fontScale = Number(params.get('font') || 100) / 100;
const width = Number(params.get('width') || 360);

if (dark) {
  document.documentElement.classList.add('dark');
  document.documentElement.setAttribute('data-theme', 'dark');
}
document.documentElement.style.fontSize = `${16 * fontScale}px`;

/** A wardrobe of cut-outs with honest proportions: a hat really is small. */
const WARDROBE = [
  { id: '1', type: 'coat', src: '/coat.png', color: 'navy', name: 'Abrigo' },
  { id: '2', type: 'top', src: '/halter.png', color: 'red', name: 'Top halter' },
  { id: '3', type: 'pants', src: '/trousers.png', color: 'blue', name: 'Pantalón' },
  { id: '4', type: 'sneakers', src: '/sneakers.png', color: 'white', name: 'Zapatillas' },
  { id: '5', type: 'hat', src: '/hat.png', color: 'tan', name: 'Sombrero' },
  { id: '6', type: 'bag', src: '/bag.png', color: 'brown', name: 'Bolso' },
  { id: '7', type: 'scarf', src: '/scarf.png', color: 'red', name: 'Bufanda' },
];

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** The wardrobe grid tile, the same markup app/dashboard/wardrobe uses. */
function Tile({
  item,
  scaled,
}: {
  item: (typeof WARDROBE)[number];
  scaled: boolean;
}) {
  const tint = garmentTileTint(item.color, null);
  return (
    <article className="group">
      <div
        style={tint.style}
        className={cn(
          'relative block aspect-square w-full overflow-hidden rounded-tile',
          tint.className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.src}
          alt=""
          className="absolute inset-0 h-full w-full object-contain p-3"
          style={scaled ? garmentFrameStyle(item.type, true) : undefined}
        />
      </div>
      <p className="mt-1 truncate text-[12px] font-semibold">{item.name}</p>
    </article>
  );
}

function Grid({ scaled }: { scaled: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {WARDROBE.map((item) => (
        <Tile key={item.id} item={item} scaled={scaled} />
      ))}
    </div>
  );
}

function Eraser() {
  return (
    <div className="rounded-tile bg-panel p-3">
      <AlphaBrush
        src="/halter-isnet.png"
        restoreSrc="/halter-photo.png"
        onApply={() => undefined}
        onCancel={() => undefined}
        onReset={() => undefined}
        canReset
      />
    </div>
  );
}

function ReviewTiles() {
  const [turns, setTurns] = useState(0);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {WARDROBE.slice(0, 4).map((item) => (
          <GarmentThumb
            key={item.id}
            src={item.src}
            type={item.type}
            color={item.color}
            hasCutout
            quarterTurns={item.id === '2' ? turns : 0}
            className="aspect-square w-full rounded-tile"
          />
        ))}
      </div>
      <button
        type="button"
        className="h-11 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground"
        onClick={() => setTurns((t) => (t + 1) % 4)}
      >
        Girar
      </button>
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The scenes load images; tell the screenshot script when they have settled.
    const id = window.setTimeout(() => {
      setReady(true);
      document.body.setAttribute('data-shot-ready', '1');
    }, 400);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      style={{ width }}
      className="mx-auto min-h-screen bg-background p-4 text-foreground"
      data-ready={ready ? '1' : '0'}
    >
      {scene === 'eraser' && (
        <>
          <Caption>Borra lo que sobra</Caption>
          <Eraser />
        </>
      )}
      {scene === 'framing-before' && (
        <>
          <Caption>Antes: todo al mismo tamaño</Caption>
          <Grid scaled={false} />
        </>
      )}
      {scene === 'framing-after' && (
        <>
          <Caption>Ahora: cada prenda a su escala</Caption>
          <Grid scaled />
        </>
      )}
      {scene === 'review' && (
        <>
          <Caption>Repaso rápido</Caption>
          <ReviewTiles />
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NextIntlClientProvider locale="es" messages={es} timeZone="Europe/Madrid">
      <App />
    </NextIntlClientProvider>
  </StrictMode>
);
