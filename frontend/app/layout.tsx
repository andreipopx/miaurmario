import type { Metadata, Viewport } from 'next';
import { Figtree, Bagel_Fat_One } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/sw-register';

export const dynamic = 'force-dynamic';

const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

// Wordmark only ("miaurmario" logo) — never for UI text.
const bagel = Bagel_Fat_One({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-wordmark',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Miaurmario',
  description: 'Tu armario, curado por un gato con criterio.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Miaurmario',
  },
  openGraph: {
    title: 'Miaurmario',
    description: 'Tu armario, curado por un gato con criterio.',
  },
  twitter: {
    card: 'summary',
    title: 'Miaurmario',
    description: 'Tu armario, curado por un gato con criterio.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F0F' },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${figtree.variable} ${bagel.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
