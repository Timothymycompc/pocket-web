// The privacy guard (web/privacy.js): what it catches and, as important, what it leaves alone.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain browser module
import { findPersonal, removePersonal, describe } from "../web/privacy.js";

test("finds email, phone, card (Luhn) and SSN", () => {
  const t = "Call me at (214) 555-0182 or mail tim.test@example.com. Card 4111 1111 1111 1111, SSN 123-45-6789.";
  const kinds = findPersonal(t).map((h: any) => h.kind);
  assert.deepEqual(kinds, ["phone", "email", "card", "ssn"]);
  assert.equal(describe(findPersonal(t)), "a phone number, an email address, a card number and a Social Security number");
});

test("removes them with plain markers and keeps the rest", () => {
  assert.equal(removePersonal("Text 214-555-0182 about the stroller"), "Text [phone number removed] about the stroller");
});

test("leaves product numbers, UPCs, dates, prices and model numbers alone", () => {
  for (const t of [
    "Was the Graco Quattro Tour stroller recalled?",
    "I am selling a Pearhead learning set, model 87150. Is it recalled?",
    "Check UPC 698904871507",
    "Is this person free on 2026-11-26 from 14:30 to 15:00 UTC?",
    "A late fee of $25 will be added if payment of $140.18 is not received by December 1.",
    "Order 1234 5678 9012 3456 shipped", // 16 digits that fail the Luhn sum: not a card
  ]) assert.deepEqual(findPersonal(t), [], t);
});
