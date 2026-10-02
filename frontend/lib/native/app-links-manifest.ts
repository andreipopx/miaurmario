/**
 * The two files that let Android and iOS open miaurmario.andreipop.org links
 * in the app instead of the browser (App Links / Universal Links). They're
 * served under /.well-known/ (rewritten in next.config.js) from runtime env,
 * so the signing fingerprints and Apple team id can be filled in without a
 * rebuild.
 */

export const APP_ID = 'org.andreipop.miaurmario';

/**
 * Paths the app claims. Everything a phone would be sent to from outside: the
 * magic link, invites, profiles and any screen of the app itself. The landing
 * page, legal pages and unsubscribe links stay in the browser.
 * Keep in sync with the intent filter in mobile/android/app/src/main/AndroidManifest.xml.
 */
export const APP_LINK_PREFIXES = ['/auth/callback', '/dashboard', '/invite', '/u/'] as const;

/** SHA-256 fingerprints, "AA:BB:…" (any case, colons optional), from a comma/space separated list. */
export function parseFingerprints(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((f) => f.replace(/:/g, '').toUpperCase())
    .filter((f) => /^[0-9A-F]{64}$/.test(f))
    .map((f) => f.match(/.{2}/g)!.join(':'));
}

export function assetLinks(fingerprints: string[], appId: string = APP_ID) {
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: appId,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function appleAppSiteAssociation(teamId: string | undefined | null, appId: string = APP_ID) {
  const team = (teamId ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{10}$/.test(team)) return null;
  const app = `${team}.${appId}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [app],
          components: APP_LINK_PREFIXES.map((prefix) => ({
            '/': `${prefix}*`,
          })),
        },
      ],
    },
    // Lets iOS offer saved passwords for this site inside the app.
    webcredentials: { apps: [app] },
  };
}
