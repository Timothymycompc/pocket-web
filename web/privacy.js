// privacy.js — finds personal details in a message before it can leave the phone.
// Plain code, no AI: emails, phone numbers, payment card numbers (checked with the Luhn sum)
// and US Social Security numbers. Used by app.js to offer removing them before Send.

const luhn = (digits) => {
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
};

const KINDS = [
  { kind: "email", label: "an email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "card", label: "a card number", re: /\b(?:\d[ -]?){12,18}\d\b/g, ok: (m) => { const d = m.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d); } },
  { kind: "ssn", label: "a Social Security number", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { kind: "phone", label: "a phone number", re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g },
];

/** Every personal detail found, in text order, without overlaps: [{ kind, label, start, end, text }]. */
export function findPersonal(text) {
  const hits = [];
  for (const k of KINDS) {
    for (const m of String(text).matchAll(k.re)) {
      if (k.ok && !k.ok(m[0])) continue;
      const start = m.index, end = m.index + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue; // an earlier kind already covers it
      hits.push({ kind: k.kind, label: k.label, start, end, text: m[0] });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** The text with each detail replaced by a plain marker, e.g. "[phone number removed]". */
export function removePersonal(text, hits = findPersonal(text)) {
  let out = String(text);
  for (const h of [...hits].sort((a, b) => b.start - a.start)) out = out.slice(0, h.start) + `[${h.label.replace(/^an? /, "")} removed]` + out.slice(h.end);
  return out;
}

/** "a phone number and an email address" */
export function describe(hits) {
  const labels = [...new Set(hits.map((h) => h.label))];
  return labels.length <= 1 ? labels.join("") : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
}
