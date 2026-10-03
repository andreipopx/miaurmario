const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

// Defence in depth for the session: even if some script got injected, it could only
// talk to this origin (connect-src) and could not load more code from elsewhere.
// Inline scripts stay allowed because Next's RSC payload and next-themes use them.
// Images may come from any https host (music covers, Pinterest pins, avatars).
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Baked into the client bundle; versions the service worker cache per build so
  // installed PWAs never keep stale same-name assets (e.g. Stinky clips).
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID || String(Date.now()),
  },
  experimental: {
    // Disable automatic static optimization for pages using client-side context
    missingSuspenseWithCSRBailout: false,
  },
  images: {
    unoptimized: true,
  },
  // Skip type checking and linting during build (already done in CI)
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // The service worker and the manifest must always be revalidated, or installed PWAs keep
  // an old worker / old icons (Cloudflare otherwise stamps max-age=14400 on static files).
  // nginx / Cloudflare in front must pass these through (not add their own max-age).
  async headers() {
    const noCache = [
      { key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
    ];
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/sw.js', headers: [...noCache, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/manifest.webmanifest', headers: noCache },
      { source: '/splash/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    ];
  },
  // App Links (Android) and Universal Links (iOS): built per request from the runtime env.
  async rewrites() {
    return [
      { source: '/.well-known/assetlinks.json', destination: '/app-links/assetlinks' },
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/app-links/apple-app-site-association',
      },
    ];
  },
  // /api/v1/* is proxied by app/api/v1/[...path]/route.ts rather than a rewrite here, because
  // rewrites() is serialized into routes-manifest.json at build time and so cannot honor a
  // runtime BACKEND_URL in the prebuilt image.
};

module.exports = withNextIntl(nextConfig);
