# Pocket Web: plan (working name)

An agentic web browser for your phone, for the Open Agentic Web Challenge
(due 2027-01-11 10:00 Dallas). It is built from the challenge's own goals: agent
sites made by independent teams, found without a central server, working
together for a person, with their consent, on the device most people use.

## What it does

1. **Directory from the live public list.** The app reads the challenge's public list
   (cognizant-ai-labs/agentic-web, docs/agentic_websites.md) and each site's own
   agent-manifest.json. When any team adds a new entry, it shows up in the app
   automatically, as a place you can send things to. Nothing is hard-coded per site.
2. **Share to an agent.** An installable phone app (PWA, Android share target). In any
   app, tap Share > Pocket Web: a link, text, a photo or a file goes to the right
   agent site (Recalled? for baby gear, Plainly for a bill, Deadline Desk for a contest...).
   The app asks your permission before contacting each site.
3. **Peers run in your browser.** Other teams' agents run on your phone through the
   reference runtime, on the model you choose. Your key never goes to them.
4. **Phone actions, with permission.** Agents can propose: add to calendar, draft a
   text, open a map, share the answer back out. You confirm each one; nothing is
   sent for you.
5. **Daily refresh + health check.** A scheduled job reads the list every day,
   adds new sites, and asks each one a real question from its own sample queries
   in a real browser. The app shows which sites answered today.

## Steps

- [x] Survey the list: 19 of 20 sites can be loaded from another origin (scripts/survey.mjs).
- [ ] Live peer test of every site (scripts/peer-test.mjs in Node; bridge-based sites
      such as Recalled? need a real browser -> Playwright in Cloud Build).
- [ ] App shell: PWA manifest + share target + service worker; directory page.
- [ ] Front agent "pocket_router" generated from the live list; peer hand-off.
- [ ] Phone actions (calendar .ics, sms draft, map, share out) as confirmed site actions.
- [ ] Inference: BYOK first-class + small free default.
- [ ] Daily refresh job (Cloud Scheduler + Cloud Run job) + uptime alert.
- [ ] Deploy to Cloud Run (x300-506418), public repo, README, PRINCIPLES.md, ship script.
- [ ] Video script (Tim's own voice) + Devpost text.
