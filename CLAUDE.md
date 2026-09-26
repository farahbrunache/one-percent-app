# Agent instructions — One Percent app

The checkout, the claim page somebody keeps, and the screen the owner confirms payments on.
Deployed to `app.farahbrunache.com` by Vercel, with its own database and its own secrets.

The page One Percent is sold from is a separate repository, `one-percent-landing-page`, on
`farahbrunache.com`. That split is deliberate: a change to sales copy must not redeploy the
code that holds money, and the two do not share environment variables.

One Percent is paid work and a separate product from Skills Economy, which is free and
self-service. Nothing here requires an account anywhere.

The stylesheet is a copy of the landing page's, taken at the split. The two are expected to
drift as these screens grow. Do not build a shared package for one CSS file.

## One phone-width layout at every viewport

The same column at every screen size, centred on anything wider than a phone. Never a second
layout for desktop.

One thing to build, one thing to check, and every person sees what every other person sees.
Anything sized in viewport units breaks that — it is one size on a phone and another inside
the frame on a desktop — so size in fixed units.

Check a change by rendering at 390 pixels rather than assuming. Playwright with the
preinstalled Chromium does it; the horizontal overflow figure should always be zero.

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

## Every schema statement must survive running twice

`ensureSchema` runs on every cold start, not once at deploy. So every statement in it has to
be safe to run against a database that has already had it run — `create table if not exists`,
`add column if not exists`, `drop column if exists`.

A plain `update` that reads a column the same function later drops works the first time and
fails every time after it. Guard anything like that with a check on `information_schema`, or
the site returns a database error on a page somebody is trying to pay from.

There is no migration tool and no terminal to run one from. This function is the whole of it.

## The owner works from a phone and has no terminal

Never end a piece of work with a command for them to run. Anything they have to do must be
doable in a web dashboard. Everything configurable is an environment variable so it changes
without a deploy.

## Voice

No pleasantries, no first-person feeling words, no jargon. State the result and stop. The
full list is in `chargingthefuture/chargingthefuture` → `CLAUDE.md`, and it applies to page
copy, commit messages and pull request bodies alike.

Never quote the owner's messages in a commit message, a pull request body, or a file. Write
what changed in your own words.

## Branches, pull requests and checks

Descriptive branch off the trunk, surgical change, pull request opened ready for review with
the title and body set at creation.

Run `npm test` before pushing. It covers every request path that does not need a database.

Never watch a pull request. After opening one, do not subscribe to its activity and do not
wait for its checks. The harness subscribes on its own; unsubscribe straight away.

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
