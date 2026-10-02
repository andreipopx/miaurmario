# The Android and iOS app

Miaurmario ships to the stores as a [Capacitor](https://capacitorjs.com/) shell
around the live site. The app's WebView loads `https://miaurmario.andreipop.org`,
so every web deploy reaches the app at once, accounts and data are the same as
in the browser, and the web keeps working exactly as before for anyone who
doesn't install anything.

What the shell adds over the browser / home-screen PWA:

| | How |
|---|---|
| Push notifications on Android and iPhone | OS push (FCM / APNs) instead of Web Push, same toggles and the same "Este dispositivo" card |
| Real haptics (Stinky's purr on iPhone too) | `@capacitor/haptics` behind `lib/native/haptics.ts` |
| Android back button | closes the open sheet, then goes back, then to Hoy, then leaves (`lib/native/app-links.ts`) |
| Links open in the app | magic link, invites, profiles: App Links + Universal Links |
| Launch screen, icon, status bar | Stinky on pink; the status bar follows the theme |
| Offline wardrobe | service worker + React Query copy in IndexedDB (also in the PWA) |

The camera needs nothing native: the file input opens the phone's own camera
app, so the app never asks for camera permission.

## Layout

```
mobile/
  capacitor.config.ts   app id, server URL, allowed sign-in hosts, plugin config
  www/                  offline.html shown if the site can't load at all
  assets/               icon + splash sources (scripts/source-assets.mjs)
  android/              Android Studio / Gradle project
  ios/                  Xcode project (Swift Package Manager, no CocoaPods)
frontend/lib/native/    the web side: detection, push, haptics, links, back button
frontend/components/native/app-bridge.tsx   wires the plugins up at start
backend/app/services/native_push.py         FCM + APNs senders
```

The web side detects the app by `window.Capacitor` or the `MiaurmarioApp/1`
suffix the shell adds to the user agent (`lib/native/app-shell.ts`).

Bundle / package id: **`org.andreipop.miaurmario`**. It can never change once
published.

## Building

### Android (this machine)

Java 21 and the Android SDK live in the user's home (`~/.local/opt/jdk21`,
`~/Android/Sdk`):

```bash
export JAVA_HOME=~/.local/opt/jdk21 ANDROID_HOME=~/Android/Sdk PATH=~/.local/opt/jdk21/bin:$PATH
cd mobile && npm ci
npm run android:apk       # debug APK, installable by hand
npm run android:release   # signed APK + AAB (needs the upload key, below)
```

Outputs land in `mobile/android/app/build/outputs/{apk,bundle}/`.

**Upload key.** `~/.config/miaurmario/upload-keystore.jks` plus its passwords in
`~/.config/miaurmario/keystore.properties` (copy that file to
`mobile/android/keystore.properties` to build releases; it's gitignored).
**Back both files up somewhere safe** (password manager). With Play App Signing
a lost upload key can be reset through Google support, but it takes days.

Its SHA-256 (needed for App Links):

```bash
keytool -list -v -keystore ~/.config/miaurmario/upload-keystore.jks | grep SHA256
```

### iOS (GitHub Actions, no Mac needed)

`.github/workflows/mobile.yml` runs on GitHub's macOS runners (free for this
public repo):

- every push touching `mobile/`: an unsigned simulator build, to catch a broken
  Xcode project;
- run by hand (Actions → Mobile apps → Run workflow) with **Upload to
  TestFlight** ticked: archive, cloud signing and upload to App Store Connect.

The same workflow also builds the Android APK/AAB as a downloadable artifact.

### Icons and launch screen

```bash
cd mobile && node scripts/source-assets.mjs && npm run assets
```

Android's launch screen is drawn by hand, not from those images: a plain
background (`@color/launch_background`, white / near-black at night) with
`splash_icon` centred at its own size (`res/drawable/launch_screen.xml`), so it
never stretches on odd screen shapes. `npm run assets` deletes the stretched
`splash.png` files it would otherwise add back. No theme has a title bar: some
launchers (Huawei's) draw it, app name included, for an instant at start.

The app opens on `/dashboard` (`server.appStartPath`), never `/`: the server
redirects signed-in browsers from `/` to `/dashboard`, but Android's WebView
proxy follows redirects itself and would serve the wrong page.

## One-time setup (accounts and keys)

Everything below is free except the two store accounts. Until a step is done
the matching feature simply stays off; nothing breaks.

### 1. Google Play (25 USD, once)

1. Create a developer account at <https://play.google.com/console>.
2. Create the app, package `org.andreipop.miaurmario`, and accept **Play App
   Signing**.
3. Upload `app-release.aab` to the **Internal testing** track (the first
   upload has to be manual; later ones can come from CI).
4. In *Setup → App signing*, copy the **app signing key SHA-256**.
5. Set `ANDROID_APP_CERT_SHA256` on the frontend to both fingerprints (Play's
   and the upload key's), comma separated. Check
   `https://miaurmario.andreipop.org/.well-known/assetlinks.json`.

### 2. Firebase (free): Android push

1. Create a project at <https://console.firebase.google.com> and add an
   Android app with package `org.andreipop.miaurmario`.
2. Download `google-services.json` into `mobile/android/app/` (gitignored) and
   add it as the GitHub secret `ANDROID_GOOGLE_SERVICES_JSON`. Rebuild.
3. *Project settings → Service accounts → Generate new private key*. Put the
   JSON (one line) or its path in `FCM_SERVICE_ACCOUNT_JSON` on **backend and
   worker**.

Without `google-services.json` the app works but never asks for notification
permission (the server only offers push for configured platforms).

### 3. Apple Developer Program (99 USD / year)

1. Enrol at <https://developer.apple.com/programs/>. Note the **Team ID**.
2. *Certificates, IDs & Profiles → Identifiers*: register
   `org.andreipop.miaurmario` with **Push Notifications** and **Associated
   Domains**.
3. *Keys*: create a key with **Apple Push Notifications service (APNs)**.
   Download the `.p8` (only once!). On **backend and worker**: `APNS_KEY_ID`,
   `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the .p8 contents or path).
4. Set `APPLE_TEAM_ID` on the frontend. Check
   `https://miaurmario.andreipop.org/.well-known/apple-app-site-association`.
5. In App Store Connect create the app (bundle id above) and, under *Users and
   Access → Integrations*, an **App Store Connect API key** with the *Admin*
   role (cloud signing needs it).
6. GitHub secrets: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
   `APP_STORE_CONNECT_KEY_P8` (the .p8 contents), `APPLE_TEAM_ID`.
7. Run the workflow with *Upload to TestFlight*; the build shows up in
   TestFlight after Apple's processing (10–30 min).

### Environment summary

| Variable | Where | Purpose |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | backend, worker | Android push |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | backend, worker | iPhone push |
| `APNS_BUNDLE_ID` | backend, worker | defaults to `org.andreipop.miaurmario` |
| `APNS_USE_SANDBOX` | backend, worker | `true` only for builds run from Xcode |
| `ANDROID_APP_CERT_SHA256` | frontend | `/.well-known/assetlinks.json` |
| `APPLE_TEAM_ID` | frontend | `/.well-known/apple-app-site-association` |

## Store review notes

- **Demo account.** Both stores sign in during review. Give them an email +
  password account (Ajustes → Seguridad) with AI enabled and a few garments.
- **Privacy policy:** `https://miaurmario.andreipop.org/legal`. Fill in Play's
  *Data safety* and Apple's *App Privacy* with what's collected: email, photos
  of clothes, approximate location (weather), optional music history.
- **Apple guideline 4.2 (minimum functionality)** is the usual reason a
  web-based app is rejected. The answer is what's native here: push, haptics,
  the camera and photo flow, Universal Links and the offline wardrobe. Mention
  them in the review notes.
- **Account deletion** must be reachable in the app (it is: Ajustes).

## Known limits

- **Huawei without Google services** (e.g. Mate 50 Pro): the APK installs and
  works, but FCM push can't reach it. It keeps email (and the browser's Web
  Push in Chrome). Huawei's AppGallery is a separate store and push service.
- **Sharing into the app** from other apps' share sheet only exists in the
  installed PWA on Android (Web Share Target) for now; the native app hides
  that hint.
- **"Continue with Google/Apple" inside Spotify/Pinterest sign-in** leaves the
  WebView for the browser and won't come back signed in; their own
  email/password sign-in works in the app.
- **Offline is read-only.** Saving changes, Stinky, suggestions and weather
  need a connection.
