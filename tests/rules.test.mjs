// Security-rule tests. Run with: npm test (starts the Firestore emulator).
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, writeBatch, serverTimestamp, deleteDoc, query, where } from "firebase/firestore";
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
    await setDoc(doc(db, "staff/cleaner@example.com"), { role: "cleaner", employeeId: "maria" });
    await setDoc(doc(db, "employees/dev"), { name: "Dev Patel" });
    await setDoc(doc(db, "jobs/j1"), { date: future, start: "10:00", status: "scheduled", price: 150, staff: ["maria"], clientId: "c1", clientEmail: "pat@example.com", site: { name: "Pat", address: "1 Main St" } });
    await setDoc(doc(db, "jobs/j2"), { date: future, start: "13:00", status: "scheduled", price: 200, staff: ["dev"], clientId: "c2", clientEmail: "sam@example.com" });
    await setDoc(doc(db, "shifts/s-dev"), { employeeId: "dev", in: "2026-10-01T13:00:00Z", out: null, note: "" });
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
    service: "Standard clean", staff: [cleaner], customer, notes: "", holds, createdAt: serverTimestamp(), clientEmail: customer.email, ...extra });
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

test("customer bookings must carry the customer's own email", async () => {
  await assertFails(booking(anon(), { extra: { clientEmail: "someone-else@example.com" } }));
});

test("cleaners see and update only their own jobs", async () => {
  const c = user("cleaner@example.com");
  await assertSucceeds(getDocs(query(collection(c, "jobs"), where("staff", "array-contains", "maria"))));
  await assertSucceeds(getDoc(doc(c, "jobs/j1")));
  await assertFails(getDoc(doc(c, "jobs/j2")));
  await assertFails(getDocs(collection(c, "jobs")));
  await assertFails(getDocs(query(collection(c, "jobs"), where("staff", "array-contains", "dev"))));
  await assertFails(getDoc(doc(c, "clients/c1")));
  await assertFails(getDocs(collection(c, "employees")));
  await assertSucceeds(getDoc(doc(c, "employees/maria")));
  await assertFails(getDoc(doc(c, "staff/owner@example.com")));
  await assertFails(updateDoc(doc(c, "jobs/j1"), { price: 1 }));
  await assertFails(updateDoc(doc(c, "jobs/j2"), { status: "done" }));
  await assertSucceeds(updateDoc(doc(c, "jobs/j1"), { status: "done", doneBy: "cleaner@example.com" }));
  await assertFails(setDoc(doc(c, "public/settings"), { name: "x" }));
});

test("cleaners clock themselves in and out, nobody else", async () => {
  const c = user("cleaner@example.com");
  await assertSucceeds(setDoc(doc(c, "shifts/s1"), { employeeId: "maria", in: "2026-10-20T13:00:00Z", out: null, note: "" }));
  await assertSucceeds(updateDoc(doc(c, "shifts/s1"), { out: "2026-10-20T16:00:00Z" }));
  await assertFails(updateDoc(doc(c, "shifts/s1"), { in: "2026-10-20T08:00:00Z" }));
  await assertFails(setDoc(doc(c, "shifts/s2"), { employeeId: "dev", in: "2026-10-20T13:00:00Z", out: null, note: "" }));
  await assertSucceeds(getDocs(query(collection(c, "shifts"), where("employeeId", "==", "maria"))));
  await assertFails(getDocs(collection(c, "shifts")));
  await assertFails(getDoc(doc(c, "shifts/s-dev")));
});

test("customers see only their own bookings and can only ask to cancel or change", async () => {
  const pat = user("pat@example.com");
  await assertSucceeds(getDocs(query(collection(pat, "jobs"), where("clientEmail", "==", "pat@example.com"))));
  await assertFails(getDocs(query(collection(pat, "jobs"), where("clientEmail", "==", "sam@example.com"))));
  await assertFails(getDoc(doc(pat, "jobs/j2")));
  await assertFails(getDoc(doc(user("pat@example.com", false), "jobs/j1")));
  await assertFails(updateDoc(doc(pat, "jobs/j1"), { status: "cancelled" }));
  await assertFails(updateDoc(doc(pat, "jobs/j1"), { request: { type: "refund", note: "", at: serverTimestamp() } }));
  await assertSucceeds(updateDoc(doc(pat, "jobs/j1"), { request: { type: "cancel", note: "Away that week", at: serverTimestamp() } }));
  await assertFails(getDoc(doc(pat, "clients/c1")));
  await assertFails(getDocs(collection(pat, "jobs")));
});
