# Pocket Web: what it is, when to use it, how to use it

Draft, written before the app is built. It is the yardstick for every build step:
if the app can't do what this page says, the app isn't done. The example sites
below are real entries on the challenge's public list. Each one stays on this page
only if it passes the live browser test.

---

## 1. What it is

**Send anything on your phone to the right AI helper on the open web.**

Pocket Web is an app for your phone. It knows every agent website on the open
agentic web's public list, built by many different people. When you share
something with it (a photo, a link or some text), it picks the helper
site that fits, asks your OK, and runs that site's agents right on your phone.

- **Nobody owns the list.** Anyone who publishes an agent site and gets listed shows up
  in Pocket Web the next day. We don't pick favorites and nobody pays to be in it.
- **Your phone does the work.** The helper's agents run in your browser. The site that
  built them never sees your AI key.
- **You stay in charge.** Pocket Web asks before it contacts any site, and before it
  does anything for you (adds a calendar event, drafts a text).

## 2. When to use it

Use it when something on your phone needs a second look, and someone on the open
web has built a helper for exactly that:

| You have... | Send it to... | You get... |
|---|---|---|
| A used stroller or car seat you're about to buy or sell | **Recalled?** | Likely recalled / possible match / no match found, with the official notice. Never "safe". |
| A bill, bank letter, lease or lab report you don't understand | **Plainly** | What it says in plain words. The agents only see a redacted copy. |
| Spare time and the wish to win something | **Deadline Desk** | Contests and hackathons you can still enter, by deadline. |
| A contest you're eyeing | **Spare Hours** | Whether it fits the free hours in your week, and the day to start. |
| Something in Indonesian or English that's hard to read | **BacaJelas** | A simpler version, a translation or a summary. |

Developer tools (agent checkers, manifest signers, conformance audits, Retrofit's
site-readiness score) live in
their own section, **For builders**, so everyday helpers come first.

**When not to use it:** for anything urgent, medical or legal where you need a
person. The helpers explain and check; they don't decide for you. And when a
helper says it doesn't know, it means it: nobody filled the gap with a guess.

## 3. How to use it (3 steps)

1. **Install it.** Open the Pocket Web page in Chrome and tap *Install app*. It now
   appears in your phone's Share menu.
2. **Share something.** In any app (Photos, Messages, Gmail, Chrome), tap *Share*,
   then *Pocket Web*. Or open Pocket Web and type a question.
3. **Approve the helper.** Pocket Web shows which site it picked and why. Tap
   *Allow* and the answer appears, with where it came from. If the answer suggests
   an action (add to calendar, draft a text, open a map), you confirm it first.
   Nothing is sent for you.

**Photos.** A shared photo stays on your phone until you tap to read it. The AI model then
copies the printed text (brand, model number, dates) into the message box. You check it and
add your question. Helper sites only get the text you send, never the photo.

**Personal details.** If your message has an email, phone number, card number or SSN,
Pocket Web stops before sending and offers to remove it.

**Whose answer is it?** The answer card shows the helper site's own words, unchanged, with
its name. Pocket Web's AI only picks the site; it never rewrites what the site said.

**Which AI does the thinking?** A free model works out of the box, with a fair daily
limit. You can switch to your own AI key in Settings; it stays on your phone and
is only sent to the AI provider you chose.

**Is a helper down today?** Every helper is tested once a day with a real question
from its own examples. The list shows *Answered today* or *Didn't answer today*, so
you know before you try.

## 4. For other builders: get your site into Pocket Web

You don't sign up with us. If your site is on the challenge's public list
([agentic_websites.md](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/agentic_websites.md)),
Pocket Web reads it within a few hours. To make it work well:

1. **Let other sites load your files.** Serve `agent-manifest.json` and your
   `.network.json` with `Access-Control-Allow-Origin: *`.
2. **Add 2-3 `sample_queries`** to your manifest's network entry. Pocket Web uses them
   to describe you to people, to pick you for the right shares, and for the daily
   live test.
3. **Write a one-line `description`** a regular person understands: what you check
   or do, and for whom.
4. **Make your front agent answer when it's called by another site.** If your
   agents rely on your page's own actions, publish them through the action bridge
   so callers can reach them.

Check how your site looks in Pocket Web, and whether it passed today's test, on
the **For builders** page.
