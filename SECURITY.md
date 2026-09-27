# Security Policy

## Reporting a vulnerability

Email **hola@andreipop.org**, or open a
[private advisory](https://github.com/andreipopx/miaurmario/security/advisories/new)
on this repository.

Please do **not** open a public issue for a vulnerability.

This is a one-person project. Expect a first reply within about a week, and
please give it 90 days before disclosing publicly — or less, by agreement, if
the fix lands sooner.

Include whatever you have: what the issue is, how to reproduce it, what an
attacker gets out of it, and the commit you tested. A suggested fix is welcome
but not required.

## What is in scope

The code in this repository and the configuration it ships with:

- the FastAPI backend and the arq worker (`backend/`)
- the Next.js frontend, including its auth configuration and its API route
  handlers (`frontend/`)
- the Docker Compose stacks, the nginx configuration and the Dockerfiles

Things worth reporting, concretely:

- **Cross-account access.** Reading, changing or deleting another user's
  garments, photos, outfits, chat history or settings. Image URLs are signed;
  a way to reach an image without a valid signature is a bug. So is a friend
  seeing more of your wardrobe than the outfits you shared with them.
- **Authentication and session handling.** Magic-link tokens, the optional
  password login, the sliding refresh, the invite-only gate, the waitlist —
  anything that lets someone in who should not be in, or that lets a non-admin
  reach the admin panel or the audit log.
- **Secret exposure.** API keys stored for a user (bring-your-own-key AI
  credentials, Spotify / Last.fm / Pinterest tokens) leaking through an
  endpoint, a log line or an error page.
- **Server-side request forgery** through any URL the server is asked to fetch —
  an AI base URL, a shop link on import, an avatar.
- **Injection** of any kind, including prompt injection that gets the stylist to
  call a wardrobe tool on behalf of a user it is not talking to.
- **Location privacy.** Coordinates are deliberately rounded to two decimals in
  the browser and again on the server. Anything finer than that reaching the
  database, a log or a third party is a bug.

## What is out of scope

- **Any live deployment.** The instances that exist are private and invite-only.
  Do not test against one you were not given written permission to test against;
  set up your own with `docker compose` instead.
- Missing hardening that is the operator's decision and is documented as such:
  running without HTTPS, exposing Postgres, choosing a weak `SECRET_KEY`.
- Findings from an automated scanner with no demonstrated impact.
- Denial of service through sheer volume.
- Vulnerabilities in a third-party dependency with no path to exploit them
  here — report those upstream. Dependabot already watches this repo.
- Social engineering, physical access, and anything requiring an already
  compromised device.

## Supported versions

There are no releases. `main` is the only supported branch, and fixes land
there.

## Operating this safely

If you self-host, the defaults that matter:

- Generate real secrets — `openssl rand -hex 32` for `SECRET_KEY` and
  `NEXTAUTH_SECRET`, `Fernet.generate_key()` for
  `INTEGRATIONS_TOKEN_ENCRYPTION_KEY` — and never commit `.env`.
- Keep Postgres and Redis off the public network. Only the frontend and the
  backend need to be reachable, and both should sit behind TLS.
- Sign-up mode is a setting in the admin panel, not an environment variable,
  and it **defaults to `open`**. On a deployment anyone can reach, switch it to
  `invite_only` before you announce the URL — otherwise anyone who finds it can
  create an account and upload to your disk.
- Uploaded photos are stored as plain files under `STORAGE_PATH`. If that
  matters to you, encrypt the volume.
- If you configure an external AI provider, garment photographs and the text of
  your chats with Stinky are sent to it. Running a local model (Ollama) keeps
  them on your hardware; running with AI off keeps them off the network
  entirely.

## Credit

Reporters are credited by name in the fix commit, if they want to be.
