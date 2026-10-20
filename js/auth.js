/*
 * Shared sign-in screen for the customer and team pages.
 * Supports email + password, a one-time emailed sign-in link, and Google.
 *
 *   const signIn = SignIn.setup({ auth, show, toast, title, intro, linkFirst });
 *   signIn.pending  → true while an emailed link is being completed
 *   signIn.show()   → render the sign-in screen with show(html)
 */
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LINK_KEY = "kk.signinEmail";
  const MSG = {
    "auth/invalid-credential": "Wrong email or password. Try again, or use Forgot password.",
    "auth/wrong-password": "Wrong email or password. Try again, or use Forgot password.",
    "auth/user-not-found": "Wrong email or password. Try again, or use Forgot password.",
    "auth/invalid-email": "Enter your full email address.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use at least 6 characters for the password.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/email-already-in-use": "This email already has an account. Use Forgot password to set a password for it.",
    "auth/requires-recent-login": "For security, sign out and back in, then try again.",
    "auth/operation-not-allowed": "This sign-in method isn't turned on yet. Ask the business owner.",
  };
  const message = e => MSG[e?.code] || "That didn't work. Check your connection and try again.";
  const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

  function setup({ auth, show, toast, title, intro, linkFirst = false, google = true }) {
    const target = location.origin + location.pathname + (/[?&]emulator\b/.test(location.search) ? "?emulator" : "");
    const val = id => (document.getElementById(id)?.value || "").trim();
    const emailVal = () => val("si-email").toLowerCase();

    function passwordForm() {
      return `<form id="si-pw" class="field" novalidate style="gap:10px">
          <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="si-pass">Password</label><input id="si-pass" type="password" autocomplete="current-password" required></div>
          <div><button class="btn primary big" type="submit">Sign in</button></div>
        </form>
        <p class="note">No password yet? <button class="link" data-si="create" type="button">Create one</button> · <button class="link" data-si="reset" type="button">Forgot password</button> · <button class="link" data-si="link" type="button">Email me a sign-in link instead</button></p>`;
    }
    function linkForm() {
      return `<form id="si-link" class="field" novalidate style="gap:10px">
          <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="email" required></div>
          <div><button class="btn primary big" type="submit">Email me a sign-in link</button></div>
        </form>
        <p class="note">We'll email you a link. Tap it on this device to sign in, no password needed. <button class="link" data-si="password" type="button">Use a password instead</button></p>`;
    }
    function screen(mode) {
      show(`<section class="signin panel">${title ? `<h2>${esc(title)}</h2>` : ""}${intro ? `<p>${intro}</p>` : ""}
        ${mode === "link" ? linkForm() : passwordForm()}
        ${google ? `<div style="border-top:1px solid var(--line);padding-top:14px"><button class="btn" data-si="google" type="button">Sign in with Google</button></div>` : ""}
      </section>`);
    }
    function createScreen(prefill) {
      show(`<section class="signin panel"><h2>Create your password</h2>
        <form id="si-create" class="field" novalidate style="gap:10px">
          <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="username" value="${esc(prefill)}" required></div>
          <div class="field"><label for="si-new">New password (at least 6 characters)</label><input id="si-new" type="password" autocomplete="new-password" required></div>
          <div class="field"><label for="si-new2">Type it again</label><input id="si-new2" type="password" autocomplete="new-password" required></div>
          <div><button class="btn primary big" type="submit">Create password</button></div>
        </form>
        <p class="note">We'll send one email to confirm the address is yours. After that you just use your password. <button class="link" data-si="password" type="button">Back to sign in</button></p></section>`);
    }

    document.addEventListener("submit", async ev => {
      const id = ev.target.id;
      if (!["si-pw", "si-link", "si-create", "si-confirm"].includes(id)) return;
      ev.preventDefault();
      const btn = ev.target.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      try {
        if (id === "si-pw") await auth.signInWithEmailAndPassword(emailVal(), document.getElementById("si-pass").value);
        if (id === "si-link") {
          const email = emailVal();
          if (!validEmail(email)) throw { code: "auth/invalid-email" };
          await auth.sendSignInLinkToEmail(email, { url: target, handleCodeInApp: true });
          try { localStorage.setItem(LINK_KEY, email); } catch (e) {}
          show(`<section class="signin panel"><div class="eyebrow">Check your email</div><h2>We sent a sign-in link to ${esc(email)}</h2>
            <p>Open the email on this device and tap the link. It can take a minute. Check Junk or Spam if you don't see it.</p>
            <p class="note"><button class="link" data-si="link" type="button">Use a different email</button></p></section>`);
        }
        if (id === "si-create") {
          const pw = document.getElementById("si-new").value;
          if (pw !== document.getElementById("si-new2").value) throw { code: "x", msg: "The two passwords don't match." };
          const cred = await auth.createUserWithEmailAndPassword(emailVal(), pw);
          await cred.user.sendEmailVerification({ url: target });
        }
        if (id === "si-confirm") await finishLink(val("si-confirm-email").toLowerCase());
      } catch (e) { if (btn) btn.disabled = false; toast(e.msg || message(e)); }
    });

    document.addEventListener("click", async ev => {
      const a = ev.target.closest("[data-si]")?.dataset.si;
      if (!a) return;
      if (a === "password") screen("password");
      if (a === "link") screen("link");
      if (a === "create") createScreen(emailVal());
      if (a === "reset") {
        const email = emailVal();
        if (!validEmail(email)) { toast("Type your email in the Email box first."); document.getElementById("si-email")?.focus(); return; }
        try { await auth.sendPasswordResetEmail(email, { url: target }); toast("If that email has an account, a link to set a new password is on its way. Check Junk too."); }
        catch (e) { toast(message(e)); }
      }
      if (a === "google") {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try { await auth.signInWithPopup(provider); }
        catch (e) { if (e.code === "auth/popup-blocked") auth.signInWithRedirect(provider); else if (e.code !== "auth/popup-closed-by-user") toast(message(e)); }
      }
      if (a === "resend-verify") { try { await auth.currentUser.sendEmailVerification({ url: target }); toast("Sent. Check your inbox and Junk folder."); } catch (e) { toast(message(e)); } }
      if (a === "verified") { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); location.reload(); }
    });

    async function finishLink(email) {
      try {
        await auth.signInWithEmailLink(email, location.href);
        try { localStorage.removeItem(LINK_KEY); } catch (e) {}
        history.replaceState(null, "", target);
      } catch (e) {
        history.replaceState(null, "", target);
        api.pending = false;
        toast(e.code === "auth/invalid-email" ? "That email doesn't match the one the link was sent to." : "That sign-in link has expired or was already used. Send a new one.");
        screen("link");
      }
    }

    const api = {
      pending: auth.isSignInWithEmailLink(location.href),
      show: () => screen(linkFirst ? "link" : "password"),
      // Shown to a signed-in user whose email isn't confirmed yet (new password accounts).
      needsVerify: email => show(`<section class="signin panel"><h2>Confirm your email</h2>
        <p>We sent an email to <strong>${esc(email)}</strong>. Tap the link in it to confirm the address is yours. You only do this once. Check Junk if it's not in your inbox.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-si="verified" type="button">I've confirmed it</button><button class="btn" data-si="resend-verify" type="button">Send it again</button></div></section>`),
      setPassword: async (openDialog) => openDialog(),
      message,
    };
    if (api.pending) {
      let saved = null; try { saved = localStorage.getItem(LINK_KEY); } catch (e) {}
      if (saved) finishLink(saved);
      else show(`<section class="signin panel"><h2>Confirm your email</h2><p>You opened the sign-in link on a different device or browser. Type the email address it was sent to.</p>
        <form id="si-confirm" class="field" novalidate style="gap:8px"><input id="si-confirm-email" type="email" autocomplete="email" required><div><button class="btn primary" type="submit">Sign in</button></div></form></section>`);
    }
    return api;
  }

  window.SignIn = { setup };
})();
