# One Percent — checkout and sessions

Deployed to `app.farahbrunache.com`. The page One Percent is sold from lives separately, in
`one-percent-landing-page` on `farahbrunache.com`.

## What it does

1. `/buy` asks only how somebody is paying: Wise from anywhere, or an Amazon gift card for
   somebody with no bank account. No name, no email address, no phone number, no location.
2. They get a claim link and a reference. A transfer goes to the destination
   shown with that reference in the note; a gift card carries its code instead. The link is
   their only record, and nothing else stored could find their order.
3. `/admin` shows what is waiting — the reference to match in Wise, or the card code to
   redeem. Confirm or reject.
4. Confirming destroys the stored card code and opens the session on their claim link.
5. The claim page holds a button. The browser asks `/api/call` with the claim token, the
   server checks the order is confirmed and not spent, asks Retell for a web call, and hands
   the browser a one-time token. The reference travels with the call as metadata, so a
   transcript can be matched back to the payment that bought it.

There is no phone number and no spoken code. A web call cannot be reached except through a
link somebody paid for, so the gate is structural rather than a secret.

## Settings

Settings are written in Infisical, once, and the deploy workflow copies them onto the Render
service on its way past. Until Infisical is set up — it can only be administered from a
laptop — the settings are entered by hand in the Render dashboard, which a phone can do, and
the workflow leaves them alone and says in its log that it did. Adding the four Infisical
secrets to the repository switches it over with no code change. Nothing is typed into a hosting dashboard, and adding one to the
list is a change to `.github/scripts/deploy.sh` that somebody reviews.

Render needs the copy because the service reads ordinary environment variables at boot: a
site that takes money should not fail to start because a secrets service is unreachable.

Render's own auto-deploy is off. Every deploy comes from the workflow, after the checks, and
the workflow waits for it to go live rather than reporting success for having asked.

It runs as one web service built from `render.yaml`: `npm install` then `node server.js`.
`DATABASE_URL` points at the same Neon database as before. The tables are created on the
first request, so there is no migration step.

| Name | What it is |
|---|---|
| `CARD_ENCRYPTION_KEY` | 32 characters or more, from a password manager. Everything secret in the database is encrypted or keyed under it. |
| `AUTH_PUBLISHABLE_KEY` | The Skills Economy publishable key, starting `pk_live_`. Public, and the address of the sign-in service is encoded inside it. |
| `AUTH_CLIENT_ID` | The client id of the One Percent application registered in the Skills Economy dashboard, whose return address is `https://app.farahbrunache.com/auth/callback`. |
| `AUTH_CLIENT_SECRET` | Its client secret. Set it when the application's Public toggle is off, and leave it unset when that toggle is on — the code proves itself with the secret in the first case and with PKCE in the second. |
| `ADMIN_ACCOUNT_IDS` | Skills Economy account ids allowed on `/admin`, separated by commas. |
| `RETELL_SECRET_KEY` | The row named Secret Key on the API Keys tab in the Retell dashboard. It has to be the key carrying the webhook badge, because the same key both starts calls and verifies the signature on the transcript coming back. |
| `RETELL_AGENT_ID` | The agent that runs the session. |
| `PAY_WISE` | Where a Wise payment goes, exactly as somebody should type it. A handle stays as text; a link becomes a link to tap. |

Set `CARD_ENCRYPTION_KEY` once, before anybody pays. Changing it later makes every stored
card code unreadable, and it signs the sign-in cookie, so changing it also signs everybody out.

`/admin` has no password of its own. Signing in happens at Skills Economy and comes back as
an account id; `ADMIN_ACCOUNT_IDS` says which ids are allowed in. One Percent is registered
there as its own application, so it holds none of Skills Economy's keys, cannot read an
account beyond the id, and cannot sign in anybody who has not signed themselves in. The two
products stay on their own domains and nothing is shared between them.

`PAY_WISE` missing does not break the site — that route refuses with a message naming the
setting, and the gift card keeps working.

## Rules built into the code

The transcript comes back from the voice service when the session ends and is kept against
the order it was bought with — the reference travels out with the call, so nothing is matched
by hand. It is encrypted at rest, because a transcript is somebody's trade, their rate and
what is standing in their way. The payments screen shows it and copies it out as plain text,
which is how the next conversation starts from a phone.

A gift card code is money in bearer form, so it is encrypted at rest and destroyed the moment
a decision is recorded. Nothing spendable survives. The order itself is kept — reference,
amount, method, decision, reason and whether the session was started — and the payments
screen shows all of it, newest first, with a box to find one by reference.

A lost claim link is recovered with the reference or the gift card code — whichever the
person is holding, typed into the same box. Only a keyed hash of a card code is kept, so the
database alone cannot produce one.

A confirmed order opens a session up to three times inside twenty-four hours of the first. A
dropped call is started again; a link passed around does not become a week of sessions.

Nothing that identifies somebody paying is collected at any point — no name, no email
address, no location. Signing in at `/admin` is the one exception and it is not a buyer: an
account id comes back from Skills Economy and is held in a signed cookie for twelve hours.
It is never written to the database. Requests are rate limited against a keyed
hash of the caller's address rather than the address itself.

## Files

| Path | What it is |
|---|---|
| `index.html` | Sign in, and the sessions belonging to whoever signed in |
| `buy.html` | The payment form and the lost-link recovery |
| `claim.html` | Order status, and where the session starts |
| `admin.html` | The one screen with manual work on it |
| `style.css` | Shared across the pages |
| `api/submit.js` | Takes a payment, returns a claim link |
| `api/status.js` | What a claim link shows |
| `api/recover.js` | Issues a new claim link against a reference or card code |
| `api/call.js` | Checks the order and opens the session |
| `api/retell.js` | Takes the transcript back from the voice service |
| `api/admin.js` | List what is waiting, confirm or reject, everything decided so far, and taking somebody on as a client |
| `api/client.js` | What a signed-in person's own sessions are, and linking one to their account |
| `api/auth.js` | Signing in and out against Skills Economy |
| `server.js` | Which address serves which page, the headers, the one redirect |
| `lib/auth.js` | Where Skills Economy signs people in, and who is an admin here |
| `lib/crypto.js` | Encryption, keyed hashing, token and reference generation |
| `lib/db.js` | Schema, queries, rate limiting |
| `lib/orders.js` | Price, payment methods, rejection reasons, session limits |
| `lib/http.js` | Request and response helpers |
