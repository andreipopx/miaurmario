import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The app is a native shell around the live site: the WebView loads
 * miaurmario.andreipop.org, so every web deploy reaches the app at once and
 * accounts, cookies and data are the same as in the browser.
 *
 * MIAURMARIO_URL points a dev build at another server (e.g. a LAN address).
 */
const SERVER_URL = process.env.MIAURMARIO_URL ?? 'https://miaurmario.andreipop.org';

const config: CapacitorConfig = {
  appId: 'org.andreipop.miaurmario',
  appName: 'Miaurmario',
  webDir: 'www',
  // The web app reads this to know it runs inside the native shell.
  appendUserAgent: 'MiaurmarioApp/1',
  backgroundColor: '#FFFFFF',
  server: {
    url: SERVER_URL,
    // Open straight on the wardrobe (the dashboard sends anyone signed out to
    // login), never via the landing page. Not a server redirect: Android's
    // WebView proxy follows redirects itself and serves the wrong page for "/".
    appStartPath: '/dashboard',
    cleartext: SERVER_URL.startsWith('http://'),
    // Shown (from the bundle, no network needed) when the site can't load.
    errorPath: 'offline.html',
    // Integration sign-ins stay inside the app so their callback lands back in
    // this WebView, where the session lives. Anything else opens in the browser.
    allowNavigation: [
      'www.last.fm',
      'last.fm',
      'accounts.spotify.com',
      'www.pinterest.com',
      'pinterest.com',
    ],
  },
  android: {
    // Plain https only; no mixed content from the live site.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    // With WKAppBoundDomains in Info.plist, WKWebView runs the site's service
    // worker, which is what keeps the wardrobe readable offline.
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge with the site's own env(safe-area-inset-*) padding.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
    SplashScreen: {
      // Stays until the web app says its first real screen is ready
      // (lib/native/launch.ts), so neither a blank WebView nor the landing
      // page flashes by. 0 here would mean "no launch screen at all".
      launchAutoHide: false,
      launchShowDuration: 6000,
      launchFadeOutDuration: 200,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
