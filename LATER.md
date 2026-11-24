# LATER

Parked ideas. Nothing here goes into the code until the current work is done.

- **Phone actions the person confirms.** Add to calendar (.ics), draft a text (sms:), open a map, share
  the answer back out, offered as confirmed site actions when a helper's answer has a date, time or place.
- **"New this week" shelf.** Remember when each site first appeared on the public list and show the
  newest ones first, so new builders get seen.
- **Public status page for builders.** A page per listed site with its check history (the daily files in
  gs://.../pocket-web/status/<date>.json), so a builder can see when their site broke.
- **Answer the routing miss.** "Simplify this water-service notice" isn't routed to Plainly (15 of 16).
  Decide with more cases whether Plainly's description covers general notices before changing anything.
- **Tell builders about what only another origin sees** (needs Tim's OK, outward-facing): the
  challenge's own widget has no CORS; AegisWeave's network references missing agents; BacaJelas lists
  actions without a bridge; ScopeGate's action schema has an object without properties.
- **List Pocket Web on the challenge's public list** (PR to cognizant-ai-labs/agentic-web,
  docs/agentic_websites.md; needs Tim's OK).
- **Retry a timed-out helper once** in the daily check before marking it "didn't answer", to tell a
  slow day from a broken site.
