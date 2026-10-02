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

The screens behind the sign-in — the desk, payments, and what somebody sees of their own
sessions — follow the `design/ops-command-center` branch of this repository. That branch is a design tool's mockup of the operator desk — React, Tailwind and
a component library, none of which this app uses — and it is the design the owner wants. It
is not a source of code and is never merged into the trunk; it is read, and the look is
rebuilt in the plain HTML and hand-written CSS this app is made of.

Pull the branch and read the latest of it before building. It is worked on separately and
what is on it now is not what was on it last time.

That branch drew one screen, the desk. Payments and the client area were inferred from it —
the same palette, the same type, the same card, applied to what those screens already did.
When the branch gains a design for one of them, that design wins over what was inferred.

**The app has two looks and the sign-in is the line between them** (owner decision,
2026-09-28). Paying and the call are on the other side of it. They need no account, they
are the end of the path that starts on the sales page, and they keep that page's look. The
sign-in is where the product stops selling and starts working, and the two look different
because they are doing different things.

This is settled, so do not go looking for the inconsistency and correct it. One app with
two looks reads as an oversight to anybody who arrives at the stylesheet and not at the
reason, and the reason is that somebody deciding whether to spend seven dollars and
somebody working through a queue are not the same person doing the same thing. Making the
sales path look like a working surface would be the error, and so would the reverse.

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

## A way back, and a way to ask again

Every screen reached from another carries a link back to it, and every screen whose figures
go out of date while it is open carries its own control to bring them up to date. Both sit
in one row across the top: where it came from on the left, refresh on the right.

Neither is the browser's job. The back button is history rather than structure — it goes
wherever somebody happened to be, which is not the same as where the screen sits — and a
person on a phone reaching for the address bar to reload has been failed by the page.

So: payments came from the desk and says so. A person's record came from the queue and says
so. Paying and the claim page came from the sales page and say so. The desk is the top of
the operator side and has nothing above it, so it has refresh alone.

The one on the sales side points at the sales page rather than at whichever app screen sent
somebody there, because that is where those pages sit even when the path in was different.

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

## No third-party services beyond the voice service (owner decision, 2026-09-30)

No messaging service, no email service, no payment processor, no analytics, nothing. The voice
service is the single exception.

Two reasons and the second is the real one. Cost. And the owner is a target: Quora erased their
accounts, and any third party can do the same thing on any afternoon. A gated community threatens
the people doing the targeting and so does this product. Every dependency is a place somebody can
be cut off from their own livelihood.

That is why paying is a Wisetag and gift cards rather than a payment processor, why there is no
email anywhere in the product, and why reaching out to somebody happens by hand somewhere else.

**The app records what was done. It never sends anything.** Somebody is contacted on Quora or
Signal or wherever, and what comes back is typed in here. Do not reach for an integration to close
that loop — the loop is open on purpose.

The voice service is the one exposure and half of it is already hedged: the sweep copies every
call record here because they forget after seven days, so losing them would not lose the history.
What would stop is taking new calls.

## No groups, communities or memberships (owner decision, 2026-09-30)

Several people wanting the same thing are still several people. Two of them get connected to each
other and it shows on each case. There is no entity they belong to, no roster, no membership and
no shared space.

The reason is not technical. Running one would take time, money and interest the owner does not
have, and it would make them a leader of people. This is not a nation state, and the Skills
Economy holds the same line.

What people pay for is a warm introduction backed by one person's judgment. The owner stays in it
as the mutual connection. A group would replace that with a room, which is a different product
nobody asked for.

## Every screen works with no model configured

This is the condition the product runs under rather than a hedge. When there is no money the app
is live and helping people, and when there are credits the same work goes faster.

- A model is a button on a step, never the step.
- No panel is empty until a model fills it.
- Structured entry over free text, because typed fields are what make assistance possible later,
  and they are faster to fill now.
- Two contexts and nothing crosses. The owner's own material works for the owner. A person's
  material works for that person. Nothing derived from one person is ever sold to the next.

The drafting slots are already the pattern: empty means not configured, the button hides, and
nothing calls a model that is not there. Extend it rather than inventing a second shape.

## State decides the screen, never a toggle

A filter somebody forgets to set is a filter that hides a person who was waiting, and at the
volume this is built for that will happen silently.

So what appears on a screen is decided by facts about the row — unread, past the deadline,
blocked, how long it has sat. Not by switches that have to be in the right position first.

This is why the first screen has no tabs, and why there is no open-or-closed filter: a new
message outranks whether a case was closed.

## Demo records live on production, and the delete refuses real ones

There's one instance and there isn't going to be a second. Two environments means two things to
deploy, two databases to migrate and two sets of settings to keep in step, for one person. So the
product gets tested where it runs.

What makes that safe is the mark. A demo record is flagged when it's made and never afterwards,
every screen shows a DEMO chip on it, and the one thing that deletes records refuses anything
without the flag. That refusal is the safety property, not a filter — so each delete names the
flag in its own `where` clause rather than trusting a list of ids gathered a moment earlier.

**Standing rule: when a feature lands, the demo row that exercises it lands with it**, in the same
change. Otherwise the feature can't be tried on the only instance there is.

The figures are skewed while demo rows are there. That's accepted — the flag makes excluding them
from a number later one predicate in one query.

Nothing in a demo row resembles a real person. Invented names, invented transcripts, and every
reference starts `DEMO` so it's recognizable before the chip is read.

**Customers deleting their own accounts is deferred, not decided against.** There are no customers
yet, so the only thing that needs deleting is demo data, and the risk worth guarding is deleting
real data by accident. When real people are here they get a way to delete what's theirs.

**When that gets built it's a separate path with its own rules.** Never build it by loosening the
`is_demo` check on the delete that already exists. That check is the one thing standing between a
test and the real rows, and widening it to serve a customer would be exactly the accident it was
written to prevent.

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
and nothing to write in. What makes somebody a client is seven dollars, the call, and the
owner reading what the call produced — and the conversation opens at that last step, not at
the sign-in.

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

## The conversation opens on a go, and on nothing else

There is one written channel between a client and the owner, and the gate on it is the
decision. A go opens it. Nothing else does.

**Before a decision there is no conversation, and after a no-go there is none either.**
Somebody who has paid and is waiting to be read sees their sessions and nothing to write in.
Somebody told no keeps their sheet and everything they already had, and the channel is not
part of that.

This was got wrong in both directions and both are worth knowing about.

It first shipped open to anybody who had paid, with a line inviting them to write while they
waited for a decision. That is the state it must never be in: a box anybody who pays seven
dollars can write into is a way to reach one person, it costs the sender nothing and the
reader everything, and the people who find it first are the ones the seven dollars exists to
filter.

It was then removed outright, which was too far. On a go the conversation is the product. The
call has been read by a person, the sheet is written, and what happens next is the actual
work: carrying the recommendations out, and quoting for paid work when there is any. That has
to happen somewhere, and it is what somebody who was told yes is paying for.

**The opening line is scripted and says so.** When a go is recorded and the sheet is written,
one line goes into the thread asking what they make of the recommendations and whether they
want help following them through. It is stored under its own author, and both screens label
it as the opening line rather than putting it under a person's name — a scripted line wearing
somebody's name is the first thing anybody replies to, and there would be nobody there. Every
line after it is a person at both ends.

**Do not widen the gate and do not close it.** If a screen looks like it is missing a way to
get in touch, that is the gate working. If a client cannot reach anybody after a go, that is
a bug.

## Decision, never assessment

The word for go-or-no-go is a decision. Not an assessment, not a score, not a rating, not a
verdict, and not a review.

An assessment sounds like a score, and a score sounds like people are being ranked. Nobody
here is ranked. Everybody who calls gets written to; what differs is whether the
conversation opens afterwards.

This is a rule about the code as well as the screens, and it is the code half that matters,
because a caller never sees a column name. The way that word would reach somebody is a
person writing a new screen, seeing `assessment` on the row in front of them, and typing it
into a heading. The column is `decision`, the endpoint is `decide`, and there is nothing
nearby to copy the old word from.

One place keeps it: a `case_events` row written before the rename still has the kind
`assessed`, and the label table maps it to "Decided" so an old line on the trail still reads.
Nothing writes it any more.

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

A new setting is added to `.github/scripts/deploy.sh` and to `render.yaml`. The list is in
the repository rather than read from somewhere else so that adding one is a change somebody
reviews.

**Which of the two lists it goes in is the decision, and the default is `OPTIONAL_KEYS`.**
`KEYS` is for values without which the site cannot serve a page or take money; the deploy
refuses before touching Render when one of those is missing, because writing the settings
replaces all of them and an incomplete set would take the site down. Everything else is
optional and is written as empty.

Put a setting in `KEYS` and it becomes a switch that takes the entire product down while it
is off. That happened: `SWEEP_SECRET` went in the required list the day the record sweep was
built, and every deploy of the whole product failed from that moment until somebody noticed
the app was serving the morning's code. A scheduled job nobody had switched on yet held back
the screens people pay to use.

So the test is not how much the feature is wanted. It is whether the site can answer a
request without it. A feature that is switched off should say so where somebody is looking —
its endpoint refusing with the reason, its workflow failing and naming the setting — and
should never be able to stop a deploy.

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

## Copy somebody has to act on

Say exactly what to do, name the actual thing, and give the actual number.

- **Name the thing rather than referring to it.** "The 10-character code" rather than "your
  reference" or "that code". On a phone the previous sentence is often off the screen, so
  "that" points at nothing.
- **Give the number.** Ten characters, seven dollars, forty-eight hours, half an hour.
  Knowing how long the thing is, is how somebody knows they have the right thing.
- **Say where it goes, in the other app's words.** Wise calls it a reference, a note or a
  message depending on the screen, so the instruction names all three rather than the one
  this repository happens to use.
- **Number the steps when there is more than one.** First, then, then, written as prose is a
  paragraph to hold in your head. A list is a place to come back to after switching apps,
  which is what somebody is about to do.
- **Say when there is nothing to do.** Paying by gift card needs no reference anywhere.
  Saying so stops somebody hunting for a field that is not there.

None of this licenses padding. Saying the same thing twice is not clearer than saying it
once.

## Write current American English

Copy here kept coming out in a register nobody has written in for decades. Not wrong, just
old: no contractions anywhere, "by hand" for yourself, "a day on" for a day later, "so there
is no conversation" where a person would say "so there's no conversation". A reader notices
the distance before they notice the sentence, and on a paid product that distance reads as
something other than a person.

So write the way somebody says it out loud, today, in the United States.

- Use contractions. It's, isn't, hasn't, you've, they're, don't, can't, there's. Dropping
  every one of them is the single loudest tell, and it was dropped on every page.
- Say yourself, not by hand. Say a day later, not a day on. Say store, not shop.
- Use the plain verb. Saved, not kept. Started, not opened against. Charged, not taken.
- Cut the inverted aside. "What the work is worth to the person who needs it, not what the
  going rate is" beats "rather than what the going rate is".
- Keep the sentences short enough to say in one breath. A clause that needs a dash to hold
  itself together usually wants to be two sentences.

Nothing here loosens the voice rule below. Plain is not chatty: no pleasantries, no feelings,
no filler. This is about the era the words come from, not the warmth.

It applies to commit messages and pull request bodies too, for the same reason.

## Voice

No pleasantries, no first-person feeling words, no jargon. State the result and stop. It
applies to page copy, commit messages and pull request bodies alike.

The rule and its banned-term list come from `chargingthefuture/agents`, the baseline every
repository here starts from. They are settled there and are not re-argued per repository.

`.claude/hooks/check-no-pleasantries.mjs` in this repository enforces them and is the source
of truth when the two disagree. It is a copy, so a change to the baseline is copied across
rather than inherited automatically — change both or they drift. That drift happened: the ban
on one word was added upstream in September and this copy did not carry it for months.

### The banned words apply to the source, not only to a reply

The hook reads what an agent says. It never reads the repository, so for a long time every
banned word could be written into a comment, a variable name, or a line a customer reads, with
nothing looking. One was: a function named for a word on the list shipped inside a fix for a
billing bug, and because the word sat inside a camelCase name there was no word boundary in
front of it — even a hook that did read the source would have walked past it.

`scripts/checks-words.mjs` carries the same list and fails the build on any of it anywhere in
a `.js`, `.mjs`, `.html` or `.css` file, matching inside names as well as in prose. Two files
are exempt because their job is to hold the dictionary: the hook, and that check itself.

`console` has the one exemption, and it is narrow: `console.log` and a quoted `'console'` in a
list of browser globals are the identifier's real name and are not ours to rename. "The browser
console" in a sentence is the jargon the rule is about, and still fails.

A banned word in a name or a comment is not a smaller problem than one on a screen. Whoever
works on this next reads all three.

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

## Nothing gets too big to throw away

The point of keeping this modular is that a piece can be deleted or replaced without reading the
rest of it. A file nobody wants to open is a file nobody deletes, and it becomes the debt.

So `scripts/checks.mjs` fails when a file passes its limit:

| Kind | Limit |
|---|---|
| A page (`.html`) | 900 lines |
| An endpoint or a library (`.js`, `.mjs`) | 700 lines |

The numbers are a ceiling, not a target. Something approaching one is usually several things
sharing a file, and the fix is to take the smallest one out rather than to raise the limit.

Raising a limit is a decision somebody makes on purpose and says why, in the same change. It is
never done to make a red check go green.

## Branches, pull requests and checks

Descriptive branch off the trunk, surgical change, pull request opened ready for review with
the title and body set at creation.

Run `npm test` before pushing. It covers every request path that does not need a database.

Never watch a pull request. After opening one, do not subscribe to its activity and do not
wait for its checks. The harness subscribes on its own; unsubscribe straight away.

**Auto-merge goes on every pull request, without exception** (owner decision, 2026-09-29).
Turn it on as soon as the pull request is open, squash, and it merges itself when the checks
pass. Do not wait around to see it happen, and do not leave one off because the change feels
serious.

There used to be a second lane: anything touching money, signing in, the database or the
deploy waited for a person to read it. That is gone.

**The reason is who absorbs a mistake, not how much time reviewing takes.** Almost every
screen in this repository is the owner's own — the desk, payments, the settings, the
deploy. When something ships broken here, the person who finds it is the person who wrote
it, on their own screen, and they can say so in the same minute. That is what makes
shipping without a review reasonable: the feedback is immediate and it costs nobody else
anything.

Do not carry this reasoning to a repository where somebody else eats the error. It is a
fact about this product, not a position on reviews.

**So the three screens a customer touches are the exception, and they get more care rather
than less.** `buy.html`, `claim.html`, and the client area in `index.html` are where
somebody who has paid seven dollars finds out what happened — and nobody will see a mistake
on those before they do. Read the copy on those as somebody who has never seen the product,
and render them before pushing. The same goes for what the voice agent says, which lives in
the private repository, and for the sales page, which is a repository of its own.

**So the checks are the review now, and that is a real obligation rather than a
reassurance.** Nobody is going to catch it after you. Before opening anything:

- Run `npm test` and `node scripts/checks.mjs`, and read what they say rather than watching
  for the word passed.
- Render any screen you touched at 390 pixels and look at it.
- Re-read the diff as somebody trying to break it.

**And when something gets through, add the check that would have caught it, in the same
piece of work.** Not an issue, not a note, not next time. Three things shipped broken in one
day and every one was a class the gates could have caught: a function called but never
declared, a column selected but never created, a rename onto a name already taken. All three
are checked for now, and the repository is worth more for the checks than for any of the
three fixes.

A check that fails loudly is worth more than a person who means to look.

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

Buying and the call collect nothing that identifies a person — no name, no email address, no
location. A purchase has no identity. A lost claim link is recovered with the reference or the
card code and nothing else.

The name arrives later, and from one place (owner decision, 2026-10-02). After somebody reads
their sheet they're asked to sign in with Skills Economy, and when that account links their
session, the name on the account is saved on the case, sealed like everything else, and the
desk shows it in place of the code. That's the point where a purchase becomes somebody the
owner is working with. Nothing asks for a name on the way in, and signing in without linking
saves nothing.
