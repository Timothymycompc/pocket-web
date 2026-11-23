# Pocket Web

**Send anything on your phone to the right AI helper on the open agentic web.**

Pocket Web is an installable phone app and an open agentic website. It reads the
[open agentic web's public list](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/agentic_websites.md)
of agent sites, built by independent teams, and turns every one of them into a helper
you can reach from your phone's Share menu. It picks the site that fits, asks your OK,
and runs that site's agents in your own browser.

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).
What it is, when to use it and how: [docs/HOWTO.md](docs/HOWTO.md).
Principles: [PRINCIPLES.md](PRINCIPLES.md). Parked ideas: [LATER.md](LATER.md).

## Why

The open agentic web only works if sites built by strangers can find and use each
other, for a person, with that person in charge. Most agent sites so far are reached
one at a time, on a desktop, by people who already know they exist. Pocket Web puts
all of them in your pocket, and every newly listed site joins automatically.

## How it works

- **Live directory.** Every 3 hours the server reads the public list, then fetches each
  site's `agent-manifest.json` and network file the way another origin would (CORS),
  and validates the network with the reference runtime's own validator
  ([server/directory.ts](server/directory.ts)). Nobody is hand-picked. Sites that can't be
  loaded stay listed on the Builders page with the exact reason, so they can fix it.
- **One data-only network.** The directory becomes Pocket Web's network file
  (`/pocket_web.network.json`): a front agent, `pocket_guide`, whose tools are the
  listed sites' network URLs. It picks one site, says which and why, hands over the
  request in full, and answers with that site's words and name. If nothing fits, it says so.
- **Peers run in your browser.** The reference runtime
  ([nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy), vendored in `web/runtime`)
  asks before contacting each site, then loads its network and runs it locally on the
  model you chose. Your key never goes to the peer.
- **Phone app.** A PWA with an Android share target: *Share → Pocket Web* in any app
  opens the request ready to send.
- **Inference.** A free default model (Gemini, publisher-funded, capped per visitor and
  per day, with a visible queue) so it works with no setup; or bring your own key in
  settings (stored in your browser, sent only to your router).

## Run it

```sh
npm ci
npm test            # replays the real public list and sites recorded 2026-11-23
npm run dev         # http://localhost:8080 (free model needs GEMINI_API_KEY)
node scripts/load-check.mjs http://localhost:8080   # runtime loads + validates the network
```

`scripts/peer-test.mjs` asks every listed site one of its own sample questions through
the runtime. `scripts/record-fixture.ts` re-records the test fixture.

## Deploy

Google Cloud Run in project x300-506418; the Gemini key comes from Secret Manager
(`GEMINI_API_KEY`) at startup. `npm run ship -- "message"` tests, commits, pushes and deploys.

## Spec

Follows the [Minimum Viable Specification for a Worldwide Agentic Web](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md):
manifest + resolved network JSON, browser runtime, chat UI, BYOK, CORS on public files,
peer loading with consent before every third-party contact.

Runtime changes are listed in [web/runtime/CHANGES.md](web/runtime/CHANGES.md).

License: MIT (runtime: Apache-2.0, see web/runtime/LICENSE.txt).
