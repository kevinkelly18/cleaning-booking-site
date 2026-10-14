// Security-rule tests. Run with: npm test (starts the Firestore emulator).
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, collection, writeBatch, serverTimestamp, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before, after, beforeEach } from "node:test";

const A = createRequire(import.meta.url)("../js/availability.js");

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-crew",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => env?.cleanup());

const future = (() => { const d = new Date(); d.setDate(d.getDate() + 7); while (d.getDay() === 0) d.setDate(d.getDate() + 1); return A.ymd(d); })();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "staff/owner@example.com"), { role: "owner" });
    await setDoc(doc(db, "staff/helper@example.com"), { role: "staff" });
    await setDoc(doc(db, "publicCleaners/maria"), { name: "Maria", days: [1, 2, 3, 4, 5, 6], fromMin: 480, toMin: 1080, active: true });
    await setDoc(doc(db, "publicCleaners/gone"), { name: "Gone", days: [1, 2, 3, 4, 5, 6], fromMin: 480, toMin: 1080, active: false });
    await setDoc(doc(db, "clients/c1"), { name: "Private Client", phone: "555" });
    await setDoc(doc(db, "employees/maria"), { name: "Maria Lopez", rate: 20 });
    await setDoc(doc(db, "public/settings"), { name: "Test Cleaners" });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const user = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();

const customer = { name: "Pat Doe", phone: "555-123-4567", email: "pat@example.com", address: "1 Main St", access: "" };

function booking(db, { cleaner = "maria", date = future, start = 600, hours = 2, buffer = 30, skipHolds = [], extra = {} } = {}) {
  const blocks = A.blockMins(hours, buffer);
  const holds = A.holdIds(cleaner, date, start, blocks);
  const ref = doc(collection(db, "jobs"));
  const b = writeBatch(db);
  b.set(ref, { source: "online", status: "new", date, start: A.hm(start), startMin: start, duration: hours, blockMins: blocks,
    service: "Standard clean", staff: [cleaner], customer, notes: "", holds, createdAt: serverTimestamp(), ...extra });
  holds.forEach((id, i) => { if (!skipHolds.includes(i)) b.set(doc(db, "holds", id), { jobId: ref.id, cleanerId: cleaner, date, t: start + i * 15 }); });
  return b.commit();
}

test("customers can read public info but nothing private", async () => {
  const db = anon();
  await assertSucceeds(getDoc(doc(db, "public/settings")));
  await assertSucceeds(getDocs(collection(db, "publicCleaners")));
  await assertSucceeds(getDocs(collection(db, "holds")));
  await assertFails(getDoc(doc(db, "clients/c1")));
  await assertFails(getDoc(doc(db, "employees/maria")));
  await assertFails(getDocs(collection(db, "jobs")));
  await assertFails(getDocs(collection(db, "staff")));
  await assertFails(setDoc(doc(db, "public/settings"), { name: "Hacked" }));
  await assertFails(setDoc(doc(db, "clients/c2"), { name: "x" }));
});

test("a customer can book a free time", async () => {
  await assertSucceeds(booking(anon()));
});

test("a long job (5 hours + travel) fits the rule limits", async () => {
  await assertSucceeds(booking(anon(), { hours: 5, start: 480 }));
});

test("two customers cannot take the same or overlapping time", async () => {
  await assertSucceeds(booking(anon(), { start: 600 }));
  await assertFails(booking(anon(), { start: 600 }));
  await assertFails(booking(anon(), { start: 690 })); // overlaps travel time after the first job
  await assertSucceeds(booking(anon(), { start: 750 })); // after 10:00 + 2h + 30min
});

test("customer bookings are checked", async () => {
  await assertFails(booking(anon(), { cleaner: "gone" }));                      // inactive cleaner
  await assertFails(booking(anon(), { start: 420 }));                           // before 8:00 shift
  await assertFails(booking(anon(), { start: 960, hours: 3 }));                 // runs past 18:00
  await assertFails(booking(anon(), { date: "2020-01-06" }));                   // in the past
  await assertFails(booking(anon(), { extra: { status: "scheduled" } }));       // can't self-confirm
  await assertFails(booking(anon(), { extra: { price: 1 } }));                  // can't set a price
  await assertFails(booking(anon(), { extra: { customer: { ...customer, name: "" } } }));
  await assertFails(booking(anon(), { skipHolds: [0] }));                       // must claim its time
  const sunday = (() => { const d = A.parseYmd(future); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return A.ymd(d); })();
  await assertFails(booking(anon(), { date: sunday }));                         // not a work day
});

test("customers cannot read bookings back or remove holds", async () => {
  await booking(anon());
  const db = anon();
  const holds = await getDocs(collection(db, "holds"));
  await assertFails(deleteDoc(holds.docs[0].ref));
  await assertFails(getDoc(doc(db, "jobs", holds.docs[0].data().jobId)));
});

test("holds can only be made together with a new booking", async () => {
  await booking(anon());
  const db = anon();
  const holds = await getDocs(collection(db, "holds"));
  const jobId = holds.docs[0].data().jobId;
  await assertFails(setDoc(doc(db, "holds", A.holdId("maria", future, 900)), { jobId, cleanerId: "maria", date: future, t: 900 }));
});

test("staff can work with everything; strangers and unverified emails cannot", async () => {
  const staff = user("helper@example.com");
  await assertSucceeds(getDoc(doc(staff, "clients/c1")));
  await assertSucceeds(setDoc(doc(staff, "clients/c2"), { name: "New" }));
  await assertSucceeds(setDoc(doc(staff, "public/settings"), { name: "Renamed" }));
  await assertFails(setDoc(doc(staff, "staff/new@example.com"), { role: "staff" }));
  await assertFails(getDoc(doc(user("stranger@example.com"), "clients/c1")));
  await assertFails(getDoc(doc(user("helper@example.com", false), "clients/c1")));
  await assertSucceeds(getDoc(doc(user("stranger@example.com"), "staff/stranger@example.com")));
});

test("only the owner manages the staff list", async () => {
  const owner = user("owner@example.com");
  await assertSucceeds(setDoc(doc(owner, "staff/new@example.com"), { role: "staff" }));
  await assertSucceeds(deleteDoc(doc(owner, "staff/new@example.com")));
});
