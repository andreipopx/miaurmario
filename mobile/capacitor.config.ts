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
      // Hidden by the web app once the first screen has painted.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
