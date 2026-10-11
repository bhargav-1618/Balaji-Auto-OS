# Security

Balaji Auto OS is a **client-side app**: there is no server of its own. The browser talks directly to
Firebase, so the security boundary is **Firebase Authentication + the Firestore security rules
(`firestore.rules`)**. Everything below follows from that.

## Do these first (Firebase Console — no code changes, all reversible)

1. **Owner password.** The owner account's email is public (it is in the rules and the source). Use a long,
   unique password. If it was ever a short or default password — one was documented in this repo's early
   history — change it **now** (login page → *Forgot password*), then review **Authentication → Users** and
   **Usage** for sign-ins you do not recognise.
2. **Close self-registration.** Firebase Console → **Authentication → Settings → User actions** →
   untick **Enable create (sign-up)**. Staff accounts are then created only by you
   (Authentication → Users → *Add user*). Without this, anyone who has the public web API key can create an
   account and, under the default rules, read and edit all shop data.
3. **Turn off sign-in methods you do not use.** The login page only uses **Email/Password**. Disable
   **Google** and **Phone** under **Authentication → Sign-in method** unless you rely on them.
4. **Restrict the Firebase web API key.** Google Cloud Console → **APIs & Services → Credentials** → the
   *Browser key* → **Application restrictions: Websites** (your production domain and `localhost` for
   development) and **API restrictions** (only the Firebase APIs the app uses). The key is *public by
   design*; these restrictions are what stop others from using it elsewhere.
5. **Publish the rules.** `firebase deploy --only firestore:rules`, then check them in the **Rules
   playground** (owner, a staff user, and an unauthenticated request) before and after.
6. **Use 2-step verification on the Google account** that owns the Firebase project and the GitHub account
   that owns the repository.

## Optional rules hardening (off by default — nothing changes when you publish)

Both switches are fields on the document **`appSettings/roles`**. Edit that document in the Firebase
Console (Firestore → Data). The Console bypasses the rules, so it is also your recovery path.

### `allowedEmails` — restrict who counts as staff
```
allowedEmails: ["staff1@example.com", "staff2@example.com"]     (lowercase)
```
* **Absent or empty → today's behaviour:** every signed-in Firebase user is staff.
* **Non-empty →** only the owner, admins, listed emails and anyone who already has an entry in `staff`
  are staff. Anyone else — including a stranger who registers an account — is denied **every** read and write.
* Add every real staff member **before** enabling it, or they will be locked out of the data.

### `requireVerifiedEmail` — don't trust an unverified email address
```
requireVerifiedEmail: true
```
When on, a role (owner, admin or staff) is honoured only if the sign-in token's email is **verified**. This
stops an unverified self-registered account from borrowing an admin's email address.
**Order matters** — verify the owner first or you will lock yourself out:
1. On the login page use **Forgot password** and complete the reset from the email link. Completing a
   reset marks that email as verified.
2. Sign out and sign back in. Confirm it works.
3. Only then set `requireVerifiedEmail: true`.

**If you lock yourself out:** open the Firebase Console → Firestore → `appSettings/roles`, delete the
offending field (or set `requireVerifiedEmail` to `false`), and sign in again.

## Known limitations (documented design, not bugs)

* **Single-shop trust model.** Any staff member can read and edit shop records directly through the
  Firebase SDK. The per-person permissions in Settings (cost prices, exports) hide things in the UI; they
  are **not** enforced by the rules. Only deletes, role changes, backups/reset and app settings are
  admin-only on the server side.
* **The public `/verify` page does not verify anything.** It displays whatever is in the link, so a link
  can be forged. Do not treat it as proof that an invoice is genuine. Making it trustworthy needs a design
  decision (a signed token, or a minimal public verification record).
* **No server-side rate limiting.** There is no server. Sign-in throttling is Firebase's own. Consider
  enabling **Firebase App Check** to limit abuse of your API key and quota.
* **The CSP allows inline scripts** (`'unsafe-inline'`), required by the current Next.js setup. A
  nonce-based policy is future work.

## Reporting a vulnerability

Please do not open a public issue. Email the owner (see the repository profile) with the details and a
way to reproduce it.
