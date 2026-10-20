// End-to-end check against the local emulators: staff setup → customer books → staff confirms → slot is taken.
// Needs Playwright. Run: npm run e2e
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDocs, collection } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = new URL("..", import.meta.url).pathname;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  try { res.writeHead(200, { "content-type": types[extname(p)] || "text/plain" }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(5577);

const env = await initializeTestEnvironment({ projectId: "demo-crew", firestore: { rules: readFileSync(join(root, "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "staff/owner@example.com"), { role: "owner" }));

const browser = await chromium.launch();
const errors = [];
const page = async () => { const p = await browser.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const base = "http://localhost:5577/";

// 1. Staff signs in and sets up the business and a cleaner.
const admin = await page();
await admin.goto(base + "admin.html?emulator");
await admin.waitForSelector("#googleSignIn");
await admin.evaluate(() => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: "owner1", email: "owner@example.com", email_verified: true }))));
await admin.waitForSelector("text=Today at a glance");
await admin.click("button.rename");
await admin.fill("#b-name", "Sparkle Test Co");
await admin.fill("#b-phone", "555-0100");
await admin.selectOption("#b-notice", "2");
await admin.click("#dlgForm button[type=submit]");
await admin.waitForSelector("#bizName:has-text('Sparkle Test Co')");
await admin.click("[data-tab=team]");
await admin.click("[data-act=new-emp]");
await admin.fill("#e-name", "Maria Lopez");
for (const d of ["0"]) await admin.check(`#dlgForm input[name=days][value="${d}"]`); // also Sundays, so any test day works
await admin.click("#dlgForm button[type=submit]");
await admin.waitForSelector(".emp h3:has-text('Maria Lopez')");
await admin.screenshot({ path: "/tmp/claude-0/-home-user-hockey-dashboards/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-admin-team.png", fullPage: true });

// 2. Customer books online.
const cust = await page();
await cust.setViewportSize({ width: 1200, height: 900 });
await cust.goto(base + "?emulator");
await cust.waitForSelector(".svc");
assert.match(await cust.textContent("#bizName"), /Sparkle Test Co/);
await cust.click(".svc >> nth=0");
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); })();
const dayBtn = cust.locator(".cal-day:not([disabled])").first();
await dayBtn.waitFor();
await cust.screenshot({ path: "/tmp/claude-0/-home-user-hockey-dashboards/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-customer-calendar.png", fullPage: true });
await dayBtn.click();
await cust.locator(".slot:not([disabled])").first().click();
const pickedTime = (await cust.locator(".slot.sel span").textContent()).trim();
const opts = await cust.locator("#cleaner option").allTextContents();
assert.ok(opts.some(o => o.startsWith("Maria")), "cleaner dropdown lists Maria: " + opts);
await cust.selectOption("#cleaner", { label: "Maria" });
await cust.fill("#f-name", "Pat Customer");
await cust.fill("#f-phone", "555-222-3333");
await cust.fill("#f-email", "pat@example.com");
await cust.fill("#f-address", "12 Oak Ave");
await cust.selectOption("#f-beds", "3"); await cust.selectOption("#f-baths", "2");
await cust.selectOption("#f-often", "Every 2 weeks"); await cust.selectOption("#f-pets", "Dog");
await cust.fill("#f-notes", "Please skip the office.");
await cust.click("#bookBtn");
await cust.waitForSelector("text=You're booked, Pat!");
assert.match(await cust.textContent(".done"), new RegExp("at " + pickedTime + " with Maria"), "confirmation shows the booked time");
await cust.screenshot({ path: "/tmp/claude-0/-home-user-hockey-dashboards/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-customer-done.png", fullPage: true });

// 3. Same slot is now taken for the next customer.
await cust.click("[data-act=again]");
await cust.click(".svc >> nth=0");
await cust.locator(".cal-day:not([disabled])").first().click();
const sameSlot = cust.locator(".slot", { hasText: pickedTime }).first();
assert.equal(await sameSlot.isDisabled(), true, "booked time is no longer offered");

// 4. Staff sees and confirms the online booking.
await admin.click("[data-tab=overview]");
await admin.waitForSelector(".panel.online:has-text('Pat Customer')");
assert.match(await admin.textContent(".panel.online"), /Home: 3 bed \/ 2 bath · How often: Every 2 weeks · Pets: Dog\s*Please skip the office/);
await admin.screenshot({ path: "/tmp/claude-0/-home-user-hockey-dashboards/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-admin-online.png", fullPage: true });
await admin.click("[data-act=accept-online]");
await admin.waitForSelector(".panel.online", { state: "detached" });

await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const jobs = (await getDocs(collection(db, "jobs"))).docs.map(d => d.data());
  const clients = (await getDocs(collection(db, "clients"))).docs.map(d => d.data());
  assert.equal(jobs.length, 1); assert.equal(jobs[0].status, "scheduled"); assert.equal(clients[0].name, "Pat Customer");
  assert.ok(jobs[0].price > 0, "price filled from service");
  const holds = (await getDocs(collection(db, "holds"))).size;
  assert.equal(holds, jobs[0].holds.length);
});

// 5. Staff books in the app: holds get written too.
await admin.click("[data-tab=book]");
await admin.locator(".cal-day:not([disabled])").nth(3).click();
await admin.locator(".slot:not([disabled])").first().click();
await admin.fill("#bk-name", "Phone Booking");
await admin.click("[data-act=bk-confirm]");
await admin.waitForSelector("text=Confirmation to send the customer");
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const jobs = (await getDocs(collection(db, "jobs"))).docs.map(d => d.data());
  const holds = (await getDocs(collection(db, "holds"))).size;
  assert.equal(jobs.length, 2);
  assert.equal(holds, jobs.reduce((a, j) => a + j.holds.length, 0));
});

// 5b. Finished jobs pay the cleaner 80%, the business keeps 20%.
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  const jobs = await getDocs(collection(db, "jobs"));
  const { updateDoc } = await import("firebase/firestore");
  const monday = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const ds = monday.getFullYear() + "-" + String(monday.getMonth() + 1).padStart(2, "0") + "-" + String(monday.getDate()).padStart(2, "0");
  // one solo job ($150) and one job shared by two cleaners ($200) this week
  await updateDoc(jobs.docs[0].ref, { status: "done", price: 150, date: ds });
  await updateDoc(jobs.docs[1].ref, { status: "done", price: 200, date: ds, staff: [jobs.docs[0].data().staff[0], "someone-else"] });
});
await admin.click("[data-tab=team]");
await admin.click("[data-act=tsweek][data-d='0'] >> nth=0");
await admin.waitForSelector("text=Pay for this week");
const payText = (await admin.textContent("#main")).replace(/\s+/g, " ");
assert.match(payText, /\$350\s*finished jobs/, payText.slice(0, 400));
assert.match(payText, /\$280\s*to cleaners \(80%\)/);
assert.match(payText, /\$70\s*to the business/);
assert.match(payText, /Maria Lopez\s*2\s*\$200/); // 150*0.8 + 200*0.8/2
await admin.screenshot({ path: "/tmp/claude-0/-home-user/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-pay.png", fullPage: true });

// 5c. Payments: the finished jobs show as unpaid; recording one moves it to paid. Money tab and downloads.
await admin.click("[data-tab=overview]");
await admin.waitForFunction(() => document.querySelector("#main").textContent.replace(/\s+/g, " ").includes("Waiting for payment · $350"));
await admin.waitForTimeout(800); // let the page settle after the test seeded data
const patPrice = Number((await admin.textContent(".payrow:has-text('Pat Customer') .who")).match(/\$(\d+)/)[1]);
const left = 350 - patPrice;
await admin.click(".payrow:has-text('Pat Customer') [data-act=pay][data-method=etransfer]");
await admin.waitForFunction(v => document.querySelector("#main").textContent.replace(/\s+/g, " ").includes("Waiting for payment · $" + v), left);
await admin.click("[data-tab=money]");
await admin.waitForSelector("text=Monthly revenue");
const moneyText = (await admin.textContent("#main")).replace(/\s+/g, " ");
assert.match(moneyText, /\$350\s*finished jobs \(2\)/, moneyText.slice(0, 300));
assert.match(moneyText, /\$280\s*cleaner pay \(80%\)/);
assert.match(moneyText, /\$70\s*business keeps/);
assert.match(moneyText, new RegExp("\\$" + left + "\\s*still unpaid"));
assert.match(moneyText, new RegExp("E-transfer\\s*\\$" + patPrice));
const [dl] = await Promise.all([admin.waitForEvent("download"), admin.click("[data-act=csv-jobs]")]);
const csv = readFileSync(await dl.path(), "utf8");
assert.match(csv, /Date,Start,Client,Service,Price,Cleaners,Each cleaner gets,Business keeps,Payment,Paid on/);
assert.match(csv, new RegExp(`Pat Customer,Standard clean,${patPrice}\\.00,.*,E-transfer,\\d{4}-`));
assert.match(csv, /,150\.00,Maria Lopez,120\.00,30\.00,/); // solo job: 80% to Maria, 20% kept
await admin.screenshot({ path: "/tmp/claude-0/-home-user/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-money.png", fullPage: true });

// 6. Owner gives access to a non-Google email; that person signs in with an emailed link.
await admin.click("[data-tab=team]");
await admin.click("[data-act=add-staff]");
await admin.fill("#st-email", "Linkstaff@Example.com");
await admin.click("#dlgForm button[type=submit]");
await admin.waitForSelector(".staffrow:has-text('linkstaff@example.com')");
const staff2 = await page();
await staff2.goto(base + "admin.html?emulator");
await staff2.click("[data-auth=link]");
await staff2.fill("#signinEmail", "linkstaff@example.com");
await staff2.click("#emailLinkForm button[type=submit]");
await staff2.waitForSelector("text=We sent a sign-in link");
const oob = await (await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-crew/oobCodes")).json();
const code = oob.oobCodes.filter(c => c.email === "linkstaff@example.com" && c.requestType === "EMAIL_SIGNIN").at(-1).oobCode;
await staff2.goto(base + `admin.html?emulator&mode=signIn&oobCode=${code}&apiKey=demo-key&lang=en`);
await staff2.waitForSelector("text=Today at a glance");
assert.match(await staff2.textContent("#me"), /linkstaff@example.com/);
assert.equal(new URL(staff2.url()).searchParams.has("oobCode"), false, "sign-in code removed from the address bar");
await staff2.click("[data-tab=team]");
assert.equal(await staff2.locator("[data-act=add-staff]").count(), 0, "regular staff can't manage access");

// Staff sets a password, signs out, and signs back in with it (no link).
await staff2.click("#setPassword");
await staff2.fill("#pw1", "clean-pass-123"); await staff2.fill("#pw2", "clean-pass-123");
await staff2.click("#dlgForm button[type=submit]");
await staff2.waitForSelector("text=Password saved");
await staff2.click("#signOut");
await staff2.waitForSelector("#passwordForm");
await staff2.fill("#signinEmail", "linkstaff@example.com");
await staff2.fill("#signinPassword", "wrong-pass");
await staff2.click("#passwordForm button[type=submit]");
await staff2.waitForSelector("text=Wrong email or password");
await staff2.fill("#signinPassword", "clean-pass-123");
await staff2.click("#passwordForm button[type=submit]");
await staff2.waitForSelector("#me:has-text(\"linkstaff@example.com\")");
await staff2.waitForSelector(".section-head");
assert.match(await staff2.textContent("#me"), /linkstaff@example.com/);

// A brand-new password account must confirm its email before it gets in.
const fresh = await page();
await fresh.goto(base + "admin.html?emulator");
await fresh.click("[data-auth=create]");
await fresh.fill("#newEmail", "newbie@example.com");
await fresh.fill("#newPassword", "newbie-pass"); await fresh.fill("#newPassword2", "newbie-pass");
await fresh.click("#createForm button[type=submit]");
await fresh.waitForSelector("text=Confirm your email");

// A stranger with an email link gets no data.
const stranger = await page();
await stranger.goto(base + "admin.html?emulator");
await stranger.click("[data-auth=link]");
await stranger.fill("#signinEmail", "stranger@example.com");
await stranger.click("#emailLinkForm button[type=submit]");
await stranger.waitForSelector("text=We sent a sign-in link");
const oob2 = await (await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-crew/oobCodes")).json();
const code2 = oob2.oobCodes.filter(c => c.email === "stranger@example.com").at(-1).oobCode;
await stranger.goto(base + `admin.html?emulator&mode=signIn&oobCode=${code2}&apiKey=demo-key&lang=en`);
await stranger.waitForSelector("text=This account doesn't have access");

// Phone-width render of the customer page.
const phone = await page();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(base + "?emulator");
await phone.waitForSelector(".svc");
await phone.click(".svc >> nth=1");
await phone.waitForSelector(".cal-day small");
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
await phone.screenshot({ path: "/tmp/claude-0/-home-user-hockey-dashboards/fcf2d72e-4f9c-52c5-a302-1417875de0d9/scratchpad/shot-customer-phone.png", fullPage: true });
assert.equal(overflow, false, "no sideways scroll on phones");

assert.deepEqual(errors, [], "no page errors");
console.log("E2E OK");
await browser.close(); await env.cleanup(); server.close();
