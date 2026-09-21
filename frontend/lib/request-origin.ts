// Resolve the origin the *browser* used to reach us.
//
// Inside the container `request.url` is built from the internal listener
// (e.g. http://0.0.0.0:3000 or http://wardrobe_frontend:3000), so it must never
// be used to build redirects. The reverse proxy chain (Cloudflare -> Caddy ->
// nginx) forwards the public host/scheme in X-Forwarded-Host/-Proto; fall back
// to Host and finally to NEXTAUTH_URL.

const HOST_RE = /^[a-z0-9._-]+(:\d{1,5})?$/i;

function firstValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

export function getRequestOrigin(headers: Headers): string {
  const host = firstValue(headers.get('x-forwarded-host')) ?? firstValue(headers.get('host'));
  const proto = firstValue(headers.get('x-forwarded-proto'));

  const fallback = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');

  if (host && HOST_RE.test(host)) {
    const scheme =
      proto === 'https' || proto === 'http' ? proto : fallback.protocol.replace(':', '');
    return `${scheme}://${host}`;
  }

  return fallback.origin;
}
