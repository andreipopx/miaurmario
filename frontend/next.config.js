const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
      { source: '/sw.js', headers: [...noCache, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/manifest.webmanifest', headers: noCache },
      { source: '/splash/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    ];
  },
  // /api/v1/* is proxied by app/api/v1/[...path]/route.ts rather than a rewrite here, because
  // rewrites() is serialized into routes-manifest.json at build time and so cannot honor a
  // runtime BACKEND_URL in the prebuilt image.
};

module.exports = withNextIntl(nextConfig);
