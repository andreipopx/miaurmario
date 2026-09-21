import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacidad y condiciones · Miaurmario',
  description: 'Qué datos guarda Miaurmario, para qué y cómo borrarlos.',
};

const CONTACT = 'hola@andreipop.org';
const UPDATED = '21 de septiembre de 2026';

const sections: { title: string; body: string[] }[] = [
  {
    title: 'Quién está detrás',
    body: [
      `Miaurmario es un proyecto personal de Andrei Pop. Para cualquier cosa relacionada con tus datos escribe a ${CONTACT}.`,
    ],
  },
  {
    title: 'Qué datos guardamos',
    body: [
      'Tu email (para entrar con enlace mágico), tu nombre de usuario y, si los añades, tu nombre visible, biografía, ubicación aproximada y preferencias de estilo.',
      'Las fotos de tus prendas, sus etiquetas y los conjuntos, valoraciones e historial que generes dentro de la app.',
      'Si conectas Spotify: lo que estás escuchando, tus reproducciones recientes y tus artistas más escuchados, solo para inferir el "mood" con el que se sugieren looks. No guardamos tu historial completo.',
      'Si conectas Pinterest: los tableros y pines que elijas importar, en modo solo lectura. Nunca publicamos nada en tu cuenta.',
      'Los tokens de acceso de Spotify y Pinterest se guardan cifrados y puedes revocarlos desconectando la integración en Ajustes.',
    ],
  },
  {
    title: 'Para qué los usamos',
    body: [
      'Únicamente para que la app funcione: mostrarte tu armario, sugerirte conjuntos, el tiempo de tu zona y avisos que tú actives.',
      'No vendemos ni cedemos tus datos, no mostramos publicidad y no los usamos para entrenar modelos.',
    ],
  },
  {
    title: 'Con quién se comparten',
    body: [
      'Proveedor de IA (API compatible con OpenAI): recibe las fotos y descripciones de prendas necesarias para etiquetarlas y sugerir looks.',
      'Resend: envía los emails de acceso. Cloudflare: protege y sirve la web. Open-Meteo: datos del tiempo según tu ubicación aproximada.',
      'Spotify y Pinterest: solo si tú conectas tu cuenta, y solo para leer los datos descritos arriba.',
    ],
  },
  {
    title: 'Dónde y cuánto tiempo',
    body: [
      'Los datos se guardan en un servidor propio en la Unión Europea mientras tengas cuenta. Si borras tu cuenta o nos lo pides, eliminamos tus datos y fotos en un plazo máximo de 30 días.',
    ],
  },
  {
    title: 'Tus derechos',
    body: [
      `Puedes pedir acceso, corrección, exportación o borrado de tus datos, u oponerte a su tratamiento, escribiendo a ${CONTACT}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`,
    ],
  },
  {
    title: 'Condiciones de uso',
    body: [
      'Miaurmario se ofrece tal cual, sin garantías, y puede cambiar o dejar de estar disponible. Sube solo fotos que tengas derecho a usar y no uses la app para nada ilegal o que moleste a otras personas.',
    ],
  },
];

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="space-y-3">
        <p className="label-editorial">Legal</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Privacidad y condiciones</h1>
        <p className="text-sm text-muted-foreground">Última actualización: {UPDATED}</p>
      </header>

      <div className="mt-10 space-y-8">
        {sections.map((s) => (
          <section key={s.title} className="space-y-3">
            <h2 className="text-xl font-semibold">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-sm">
        <Link href="/login" className="link-editorial">
          Volver a Miaurmario
        </Link>
      </footer>
    </main>
  );
}
