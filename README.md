# Kristally Klean website

Two pages:

- **`index.html` — booking site for customers.** Customers pick a service, a day on the calendar, an open time and a cleaner from a dropdown of who's free, then enter their details. No account needed. Their booking goes straight onto your schedule and blocks that cleaner's time so nobody else can take it.
- **`admin.html` — the staff app, for you and your staff.** Sign in with Google. Confirm or decline online bookings, book jobs yourself, keep client details, set each cleaner's work days and hours, clock in/out, and see weekly timesheets with estimated pay.

It runs on two free services:

- **Firebase** (Google) holds the data and handles staff sign-in. The free "Spark" plan is plenty for a small business.
- **GitHub Pages** hosts the website for free.

## One-time setup (about 20 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Create a project** → name it (e.g. `sparkle-cleaning`) → you can turn Google Analytics off → **Create**.
3. On the project home page click the **Web** icon (`</>`) to add a web app. Give it a nickname, leave "Firebase Hosting" unticked, click **Register app**.
4. You'll see a block of code with `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., appId: ... }`. Copy those four values into **`js/config.js`** in this repository (replace the `PASTE_...` text). These values are safe to be public.

### 2. Turn on the database
1. In the left menu: **Build → Firestore Database → Create database**.
2. Pick a location close to you, choose **Start in production mode**, click **Create**.
3. Open the **Rules** tab, delete what's there, paste the whole contents of **`firestore.rules`** from this repository, and click **Publish**.

### 3. Turn on staff sign-in
1. **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose your support email, **Save**.
2. Also on **Sign-in method**: **Add new provider → Email/Password**, turn on **Email link (passwordless sign-in)**, **Save**. This lets staff with Hotmail, Outlook, Yahoo or other non-Google emails sign in with a link sent to their inbox.
3. Still in Authentication, open **Settings → Authorized domains → Add domain** and add `YOUR-GITHUB-USERNAME.github.io`.

### 4. Make yourself the owner
1. **Firestore Database → Data → Start collection**. Collection ID: `staff`.
2. Document ID: **the owner's email address in lowercase** (e.g. `you@gmail.com` or `you@hotmail.com`). Gmail addresses sign in with Google; any other email signs in with an emailed link.
3. Add a field: name `role`, type string, value `owner`. **Save**.

You only do this once. After that you add staff from inside the app (Team & Time → Staff access).

### 5. Publish the website
1. In this GitHub repository: **Settings → Pages**.
2. Under "Build and deployment", Source: **Deploy from a branch**, Branch: **main**, folder **/(root)** → **Save**.
3. After a minute your site is live at `https://YOUR-GITHUB-USERNAME.github.io/REPOSITORY-NAME/`.
   - Customers book at that address.
   - You sign in at `.../admin.html`.

### 6. Fill in your business details
Sign in to `admin.html`, then:
1. **Settings** (next to the business name): name, phone, email, service area, booking hours, travel time between jobs, how much notice customers must give, and your **services with hours and starting prices**.
2. **Team & Time → Add team member** for each cleaner, with the days and hours they work. Only their first name is shown to customers.
3. Open your booking site and make a test booking. It appears at the top of **Today** in Crew HQ under "New online bookings". Click **Confirm** (adds them as a client) or **Decline** (frees the time).

## Using your own domain (optional)
Buy a domain (e.g. from Namecheap or Cloudflare), then follow GitHub's guide: Settings → Pages → Custom domain. Add the same domain under Firebase Authentication → Authorized domains.

## Good to know
- **Privacy:** customers can only see business info, cleaners' first names and which times are taken. They can't see other customers, bookings, pay rates or timesheets. Only people on your staff list can.
- **Spam:** anyone with the link can make a booking, the same as any online booking form. You confirm every online booking before it counts, and declining one frees the time. If spam becomes a problem, Firebase App Check (reCAPTCHA) can be added.
- **Notifications:** Crew HQ shows new bookings live while it's open, but it doesn't send texts or emails. A Firebase "Trigger Email" extension or a Zapier hookup can add that later (needs the paid Blaze plan for extensions).
- **Payments** aren't collected online; prices are estimates you confirm.

## For developers
Plain HTML/JS, no build step. Firebase SDK files are in `vendor/`.

```
npm install
npm test        # booking math + security-rule tests (needs Java for the Firestore emulator)
npm run e2e     # browser test of the full booking flow (needs Playwright)
```
Open either page with `?emulator` to point it at local emulators (`npx firebase emulators:start --project demo-crew`).
