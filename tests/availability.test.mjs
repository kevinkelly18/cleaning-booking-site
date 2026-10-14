import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../js/availability.js");

const cfg = A.settings({ open: "08:00", close: "18:00", buffer: 30, step: 30, minNoticeHours: 24, maxDaysAhead: 60 });
const maria = { id: "maria", days: [1, 2, 3, 4, 5, 6], fromMin: 480, toMin: 1080, active: true };
const dev = { id: "dev", days: [1, 2, 3], fromMin: 540, toMin: 900, active: true };
const wed = "2026-10-21"; // a Wednesday

test("blocks include travel time, rounded up to 15 minutes", () => {
  assert.equal(A.blockMins(2, 30), 150);
  assert.equal(A.blockMins(2.5, 0), 150);
  assert.equal(A.blockMins(1, 10), 75);
  assert.deepEqual(A.holdIds("m", wed, 600, 45), ["m_" + wed + "_600", "m_" + wed + "_615", "m_" + wed + "_630"]);
});

test("slots respect working hours and existing holds", () => {
  const taken = new Set(A.holdIds("maria", wed, 600, A.blockMins(2, 30))); // Maria busy 10:00-12:30
  const slots = A.slotsFor(wed, 2, [maria, dev], taken, cfg, null);
  const at = t => slots.find(s => s.t === t).free.map(c => c.id);
  assert.deepEqual(at(480), []);               // 8:00 + 2h + 30 would run into 10:00 job; Dev starts 9:00
  assert.deepEqual(at(540), ["dev"]);          // 9:00: Maria blocked by job, Dev free
  assert.deepEqual(at(750), ["maria", "dev"]); // 12:30 free again
  assert.deepEqual(at(810), ["maria"]);        // 13:30 + 2h passes Dev's 15:00 end
  assert.equal(slots.at(-1).t, 960);           // last 2h start is 16:00
});

test("minimum notice and booking window", () => {
  const now = new Date(2026, 9, 20, 15, 0); // Tue 15:00
  const s = A.slotsFor(wed, 2, [maria], new Set(), cfg, now);
  assert.equal(s[0].t, 900);                   // 24h notice → Wed 15:00 earliest
  assert.equal(A.slotsFor("2026-10-20", 2, [maria], new Set(), cfg, now).length, 0);
  assert.equal(A.slotsFor("2027-01-20", 2, [maria], new Set(), cfg, now).length, 0);
});

test("days off", () => {
  const sun = "2026-10-25";
  assert.ok(A.slotsFor(sun, 2, [maria, dev], new Set(), cfg, null).every(s => s.free.length === 0));
});
