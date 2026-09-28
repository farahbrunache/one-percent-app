# Agent instructions — One Percent app

The checkout, the claim page somebody keeps, and the screen the owner confirms payments on.
Deployed to `app.farahbrunache.com` by Render, as one web service with its own database and
its own settings. Skills Economy is on Render too, so there is one dashboard, one bill and
one place settings live. Vercel is for landing pages here and nothing else.

The page One Percent is sold from is a separate repository, `one-percent-landing-page`, on
`farahbrunache.com`, and that one is static and stays on Vercel. That split is deliberate: a change to sales copy must not redeploy the
code that holds money, and the two do not share environment variables.

One Percent is paid work and a separate product from Skills Economy, which is free and
self-service. Nothing here requires an account anywhere.

The stylesheet is a copy of the landing page's, taken at the split. The two are expected to
drift as these screens grow. Do not build a shared package for one CSS file.

## This repository is public

Everything committed here is world-readable, and a commit cannot be unsaid. Nothing secret
goes in a file, a test fixture, a comment, a commit message or a pull request body: no key,
no client secret, no token, no account id, no real payment reference, and nothing about a
person who has paid.

A value read off a dashboard is not repository material. It becomes an environment variable
and the repository refers to it by name — `AUTH_CLIENT_ID`, `ADMIN_ACCOUNT_IDS` — never by
value, not even in an example. Where an example is needed, invent one that is obviously not
real, as the tests do.

Nothing here is defended by being hard to find. Every rule this site enforces holds with the
source in front of somebody: the price, the reference alphabet, the rate limits, the three
starts in twenty-four hours. Reading the code has to be no help at all in taking money out
of it, and that is a constraint on every change, not a property of today's code.

Never copy anything out of the private `one-percent` repository into this one. Session
transcripts, notes on people, consent records and the method itself live there and stay
there.

If a secret ever reaches a commit, rotate it at the service that issued it. Deleting the line
does not help — the old commit is still readable by anybody who cloned it.

## One phone-width layout at every viewport

The same column at every screen size, centred on anything wider than a phone. Never a second
layout for desktop.

One thing to build, one thing to check, and every person sees what every other person sees.
Anything sized in viewport units breaks that — it is one size on a phone and another inside
the frame on a desktop — so size in fixed units.

Check a change by rendering at 390 pixels rather than assuming. Playwright with the
preinstalled Chromium does it; the horizontal overflow figure should always be zero.

## Where the design comes from

Two surfaces, two answers.

The sales page is settled. Its design stays as it is and is not redesigned, restyled or
reorganized. A change there is copy or a fix, never a new look.

The screens behind the sign-in follow the `design/ops-command-center` branch of this
repository. That branch is a design tool's mockup of the operator desk — React, Tailwind and
a component library, none of which this app uses — and it is the design the owner wants. It
is not a source of code and is never merged into the trunk; it is read, and the look is
rebuilt in the plain HTML and hand-written CSS this app is made of.

Pull the branch and read the latest of it before building. It is worked on separately and
what is on it now is not what was on it last time.

Follow it, never copy it. Three things do not travel with it:

- Copy that does not make sense. A mockup is filled with invented names, invented figures and
  a product name that is not ours, because it has to show something. Write what this screen
  actually says, or leave the screen's own words alone.
- A feature this product does not have. The mockup shows controls nobody has built or asked
  for. One that gets built because it was in the picture ships looking like a decision
  somebody made.
- Anything that would overwrite copy or layout already shipped here. Be additive and
  surgical: change what the task needs and leave the rest as it ships.

**A new feature is the owner's call, every time.** If following the design would add a
capability this product does not have, stop and ask. Do not build it and offer to remove it
afterwards.

The phone-width and dark-only rules above hold over any of this. Where the reference and one
of them disagree, the rule wins.

## No loading screens

Nothing on any screen says it is checking, reading, or loading. A screen is blank for the
moment it takes, then it is the page.

A line saying "checking who you are" is not information. It is there for a fraction of a
second, it tells somebody nothing they can act on, and it is one more thing to build,
translate and keep true when the thing underneath it changes.

What does get said is a failure. A request that does not come back says what failed and
what to do about it, in the place the content would have been. That is the rule in
`137-verbose-error-handling` terms: silence while it works, words when it breaks.

This is not a licence to leave somebody staring at nothing after they press something. A
control that starts work disables itself while the work runs, and says what it is doing on
the control itself where the wait is real and long — a call starting, a draft coming back
from a cold worker. That is a button reporting on itself, not a screen standing in for the
page.

## Dark only

One theme. No light theme, no `prefers-color-scheme` branch, no switch. A second theme is a
second thing to build, a second thing to check, and a second way for two people to look at
the same page and see different things.

Colours are tokens on `:root` and nothing is hard-coded in a rule. When rendering to check a
change, set the browser to dark — headless Chromium defaults to light and will show you a
page nobody sees.

## Never leave unused code

A change that strands something removes it in the same change: a column, an export, a CSS
rule, an endpoint, a setting, a page. Not a follow-up, not an issue, not a question for the
owner.

Search before deleting — readers, writers, the pages, the tests and the schema — and delete
the setting from the project's environment variables too, or it sits there looking required.

## The app address is the product, and it is a sign-in

`app.farahbrunache.com` is where somebody signs in with Skills Economy and reaches their own
sessions. It briefly redirected to the sales page and briefly explained itself; both were
wrong, and the second was wrong in a way worth remembering — a signpost is not a product.

Signing in grants nothing. Anybody with a Skills Economy account can do it and will see a
page saying no session is linked to them. There is no directory behind it, no other people
and no chat. What makes somebody a client is seven dollars, the call, and the owner reading
what the call produced.

So the gate is not the sign-in and must never be moved there. Keep three states apart on
that screen, because they are three different things to be told: signed in with nothing
linked, linked and waiting to be read, approved.

**Paying and the call stay account-free.** The sales page promises that, and it is true
because the claim link carries the whole of it. An account is for afterwards. Never put a
sign-in in front of buying or in front of starting a session — that would make the sales
page a lie and would lock out the people it was written for.

Nothing about an account appears on the claim page until after the call. Before it, that
page is somebody about to be spoken to for half an hour, and an account would be the only
mention of one on a path that promises none is needed. Afterwards it is the answer to a
question they now have — where does this go.

Opening a claim link while already signed in binds it silently. That is the natural moment
and it saves a paste. It says nothing on success and nothing on failure: the link works
either way, which is what that page is for.

Linking uses the claim link, not the reference. A reference is written into a payment note
and read off a screen by whoever is nearby; the claim token is the only thing only the buyer
holds.

## The client area is read-only, and stays that way

There is no way for somebody who has paid to send words to the owner. No chat, no message
box, no reply form, no contact address. There was one, it was removed, and the table behind
it was dropped. This is settled and is not to be rebuilt because a screen looks like it is
missing something.

What seven dollars buys is a half-hour call and the sheet written out of it. Being reachable
afterwards is not part of it, and a box anybody who pays can write into is a way to reach one
person that costs the sender nothing and the reader everything. The people this attracts
first are the ones the check exists to keep out.

Nobody is left with nothing by this. Somebody who thought it was worth the money comes back
and buys another call, and that is when they speak again. Somebody who did not, keeps their
sheet and everything they already had, and is out seven dollars rather than stuck in a queue
waiting on an answer.

One-way feedback on what the sheet was worth is a different thing and is allowed: it goes one
direction, it reaches no inbox, and it cannot be replied to. Build it that way or not at all.

## One server, not functions

`server.js` holds the routing table: which address serves which page, which serves which
endpoint, the security headers, the one redirect and the one rewrite. A platform
configuration file used to do that, invisibly and untestably; now it is code with tests
over it.

A path is never turned into a file name. The address is the key and the file is the value,
so there is no directory to walk out of.

It is a long-running service rather than a function billed per request, because a voice call
and a draft that takes most of a minute both need a connection that stays open.

## The transcript is the product, not a by-product

A session nobody can read produced nothing. The voice service keeps its own copy in its own
dashboard, and that is not a place the work can be done from: the owner reads a transcript on
a phone and starts the next conversation out of it.

So it is copied here when the call ends, filed against the order it was bought with, and
encrypted at rest along with everything else. It is somebody's trade, their rate, their first
customer and what is standing in their way.

Never put a transcript anywhere it can be read without signing in, never log one, and never
put one in a test fixture — this repository is public. Invent the words in a test.

## Every schema statement must survive running twice

`ensureSchema` runs on every cold start, not once at deploy. So every statement in it has to
be safe to run against a database that has already had it run — `create table if not exists`,
`add column if not exists`, `drop column if exists`.

A plain `update` that reads a column the same function later drops works the first time and
fails every time after it. Guard anything like that with a check on `information_schema`, or
the site returns a database error on a page somebody is trying to pay from.

There is no migration tool and no terminal to run one from. This function is the whole of it.

## Settings are written once, in Infisical

Infisical is the one place a setting is written. The deploy workflow reads them and copies
them onto the Render service, so nothing is ever typed into a hosting dashboard and no two
places can disagree about a value.

Render holds the copy the service reads at boot. Nothing has to reach Infisical for the site
to start, which matters for a site that takes money.

A new setting is added to `KEYS` in `.github/scripts/deploy.sh` and to `render.yaml`. The
list is in the repository rather than read from somewhere else so that adding one is a
change somebody reviews. The deploy refuses before touching Render if Infisical has no value
for one of them, because writing the settings replaces all of them and an incomplete set
would take the site down.

Never put a value in either file. This repository is public.

Infisical can only be administered from a laptop, and the owner works from a phone. Until it
is set up, the settings are entered by hand in Render and the deploy leaves them alone,
saying so in its log rather than passing over it silently. Adding the four Infisical secrets
to the repository switches it over; nothing in the code changes. Do not build a second path
for the interim — there is one deploy, and it already handles both.

### One instance, two projects

The Infisical instance is Charging The Future's. One Percent has its own project inside it
rather than its own instance.

A project is the boundary, not a folder in one. A machine identity is scoped to a single
project, so the credentials this repository's deploy workflow holds cannot read Charging The
Future's secrets, and that product's credentials cannot read these. Nothing is shared but
the server the two projects sit on.

If both products ever need the same value, that is two secrets with two lifetimes, each
rotated on its own. Copying one across makes a change in one place silently wrong in the
other.

The instance itself is Charging The Future's infrastructure and its cost belongs to that
product. One Percent's expenses are counted separately and include no share of it — what is
counted here is what appears on a bill because One Percent exists.

A second instance would buy one thing a project does not: something to hand over. If One
Percent ever needs separate ownership, that is when it gets its own. Until then it would be
a second server, database and cache to patch, back up and keep online, and a second thing
whose downtime stops deploys.

The instance address and the project are repository secrets in GitHub, never written down
here. Pointing this repository at a different instance is two values changed and no code
touched.

## Render is driven by its API, not by a dashboard walkthrough

The platform was chosen so that an agent can do this work end to end, and the premium is
paid for that. So when something has to happen on Render — create a service, change one,
deploy one — it happens through the API from a workflow. Handing over a list of buttons to
press is not using what is being paid for, and the owner works from a phone.

A workflow written to do something once is deleted once it has done it, along with any
script only it used, in the same piece of work. Say so in its own header when you write it.
Everything with a next run stays: the deploy, the checks.

## Deploys come from the workflow, never from Render

Render's auto-deploy is off. The deploy workflow runs the checks, writes the settings, asks
Render to deploy, and then waits for it to go live — a build that reports success for having
asked is a build that hides a site which never came back.

## The owner works from a phone and has no terminal

Never end a piece of work with a command for them to run. Anything they have to do must be
doable in a web dashboard. Everything configurable is a setting so it changes without a
code change.

## Voice

No pleasantries, no first-person feeling words, no jargon. State the result and stop. It
applies to page copy, commit messages and pull request bodies alike.

The rule and its banned-term list come from `chargingthefuture/agents`, the baseline every
repository here starts from. They are settled there and are not re-argued per repository.

`.claude/hooks/check-no-pleasantries.mjs` in this repository enforces them and is the source
of truth when the two disagree. It is a copy, so a change to the baseline is copied across
rather than inherited automatically — change both or they drift.

Never quote the owner's messages in a commit message, a pull request body, or a file. Write
what changed in your own words.

## Never open an issue here

This repository's issues live in the private `one-percent` repository, along with the
landing page's and that repository's own. Open one there, and link to it from here if a
pull request needs to reference it.

You cannot tell in advance which issue turns out to carry something private. A bug report
about the call arrives with a transcript in it. A payment problem arrives with a reference
and what somebody said. This repository is public and a published issue cannot be unsaid.

The code and its history stay public, and every pull request describes its change in the
open. That is what being open source promises here. An issue queue is not part of it.

## Branches, pull requests and checks

Descriptive branch off the trunk, surgical change, pull request opened ready for review with
the title and body set at creation.

Run `npm test` before pushing. It covers every request path that does not need a database.

Never watch a pull request. After opening one, do not subscribe to its activity and do not
wait for its checks. The harness subscribes on its own; unsubscribe straight away.

Auto-merge is on in this repository. Turn it on for the pull request as soon as it is open,
squash, and it merges itself when the checks pass. Do not wait around to see it happen.

Not for everything. A change that touches money, signing in, the database or the deploy
waits for a person to read it — `api/submit.js`, `api/call.js`, `api/admin.js`,
`lib/crypto.js`, `lib/auth.js`, `lib/db.js`, `server.js`, `render.yaml`, and anything under
`.github/`. Open those ready for review and leave auto-merge off.

Everything else goes in on its own: a page's copy, a message somebody reads when something
fails, the stylesheet, documentation, a test.

The reason is the owner's time rather than speed. Every pull request that waits is a tap on
a phone, and the ones worth a tap are the ones where a mistake costs money or lets somebody
in.

## What the money rules are

Every bill this pays is charged in cash, and a gift card cannot pay one — it only offsets
spending that would have happened anyway. Two payment routes exist for that reason: Wise
reaches a bank account, and the gift card is for somebody who has none.

`PAY_WISE` holds a Wisetag, not a payment request link. A request link was tried and cannot
work here: on a personal Wise account it expires after five days, and only a business account
gets a reusable one. A setting that dies every five days is worse than a handle that does not.

The page renders either. A value starting `http` becomes a link to tap, anything else stays as
text to copy, so if the account ever becomes a business one this is a settings change and no
code change.

A gift card code is money in bearer form. It is encrypted at rest and destroyed the moment a
decision is recorded. Nothing spendable survives in the database.

Nothing that identifies a person is collected at any point — no name, no email address, no
location. A lost claim link is recovered with the reference or the card code and nothing else.
