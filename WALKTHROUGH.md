# What this app does, and how to check it

Everything the product does, in the order somebody meets it. Walk it top to bottom and you have
tested the app end to end.

Two readers. The owner, checking the thing still works after a change. The next agent, finding out
what is already here before building something that exists.

**This file is part of a change, not a follow-up.** Add or alter a feature and this file changes in
the same commit. `scripts/checks.mjs` fails when an address the server serves or an action the desk
answers is missing from it, so the list cannot quietly fall behind the code — but the words around
each line are nobody's job but the writer's, so write them.

**Where to test.** On production, against the demo records. Press **Add demo data** on the first
screen; every reference starts `DEMO` and carries a chip. Press **Delete demo data** when done — it
refuses to touch anything not marked as demo.

Legend: a line marked **(off)** needs a setting before it does anything, and names it.

---

## 1. Buying a session — no account anywhere

The sales page is a separate repository. This starts at the checkout.

- [ ] `/buy` — "Pay for a session". Reached from the sales page; the back link goes there, not into the app.
- [ ] Pick **Wise**. The Wisetag shows as a link to tap, or as text to copy, depending on the setting's value.
- [ ] Pick **Amazon gift card**. Two more fields appear: an amount, 7 to 500 dollars, and the card code.
- [ ] Type a card code in lower case with no spacing. It upper-cases and groups itself as you type.
- [ ] Submit. You get a 10-character reference, grouped `XXXXX-XXXXX`, from an alphabet with no letters that look like digits.
- [ ] You also get a claim link. That link is the only thing you hold — no account, no email, nothing to remember.
- [ ] Submit the same gift card code twice. The second is refused.
- [ ] "Lost your link?" — paste either the reference or the card code. You get a new link and the old one stops working.
- [ ] Rate limits, if you want to prove them: 10 purchases an hour, 8 recoveries an hour, per caller.

## 2. The claim page — one address, four states

`/claim?t=…`, never indexed, never cached.

- [ ] **Waiting to be confirmed.** Repeats where to send the money and under which reference. Paying by gift card says plainly that no reference is needed anywhere.
- [ ] **Rejected.** One of six reasons: not received, short, empty, already used, invalid, duplicate.
- [ ] **Confirmed.** The browser asks for the microphone *before* the session starts — a browser that will refuse was never going to work.
- [ ] Start the session. A three-second count-in, then the agent's first sentence says it is not a person and the call is recorded.
- [ ] **Used.** Before the sheet exists, it says the writing comes back here. Once it exists, it shows the sheet, asks for a Skills Economy sign-in, and offers another session.
- [ ] Open the claim link while already signed in. It binds silently — no message either way, because the link works regardless.
- [ ] "Copy this page's link" at the foot.
- [ ] Break it on purpose. A failure names the sentence, the fields that came with it, the call id, and the version of the client that was loaded.

**The numbers:** $7.00. Half an hour with the agent. Up to 3 starts in 24 hours. A 35-minute budget
— 30 plus 5 for a call that drops. A call that never connects hands its minutes back within two
minutes.

## 3. The call itself

- [ ] The transcript lands here when the call ends, encrypted, filed against the order.
- [ ] A second call against the same order is recorded as a follow-up rather than a new person.
- [ ] **(off — `SWEEP_SECRET`)** An hourly job re-fetches any call record that did not arrive. The voice service forgets after seven days, so this is what keeps the history.
- [ ] "Export the script" on the desk hands you the voice agent's configuration, to be committed.

## 4. The first screen — your morning

`/desk` with nothing in the address. No tabs and no filters: what appears is decided by facts about
rows, never by a switch you have to remember to set.

- [ ] One card per person, however many reasons they are there for. Each card lists every reason.
- [ ] **New call** — a transcript came back, no decision recorded.
- [ ] **Wrote to you** — an unread message. A blocked person drops off and returns on their date, flagged as having been blocked.
- [ ] **Answered a quote** — they agreed, declined, or asked for a change. The answer hands it back to you.
- [ ] **Owes you** — a quote agreed, past its date, nothing received.
- [ ] **You owe** — work past its date, not handed over, not dropped.
- [ ] **Ask about** — an action whose cadence date has come round.
- [ ] Oldest first, fifteen a page, numbered paging.
- [ ] A count with "N past 24 hours" against the 48 hours the claim page promises.
- [ ] Search by name or code.
- [ ] One control for demo data, reading **Add** or **Delete** from whether any exists.
- [ ] Jump to Everybody, Payments, What it costs. Sign out.

## 5. Everybody — the queue and the two funnels

`/desk?state=…&page=…`

- [ ] Four tabs with live counts: **New calls**, **Wrote to you**, **Working**, **Closed**. Membership is derived, so a count and its list cannot disagree.
- [ ] Search across all four by reference or name. Names are sealed, so matching happens after decryption.
- [ ] Twenty-five a page. Each row: name and code, DEMO chip, decision badge, call date and length, how many calls, the path, whether an account is linked, and what is owed either way.
- [ ] **Getting to a call, and what it led to** — people to approach (the one figure you type), bought a call, answered a quote, work handed over.
- [ ] "Change the list size" opens one field. Empty takes the row off the chart. The row says **typed** so it is never mistaken for a measurement.
- [ ] **How far people get** — calls that came back, worth going on with, on a path, someone to approach, approached somebody, first paying customer.
- [ ] Both are cumulative subsets and count one person once, so every drop is a real rate.

## 6. A person's record

`/desk?id=…`. Two panels always open, then fifteen sections that remember what you opened.

- [ ] **Waiting on you** — they wrote; the call record is not saved; they answered a quote; go or no-go; write their sheet.
- [ ] **Catch me up** — "Where does this stand?" drafts a recap from everything typed in. Nothing is saved, because a saved recap is wrong the moment you type another line. **(off — `DRAFT_MODEL_A_*`)**

### Now

- [ ] **Calls** — every call with its transcript and summary, and a way to save the record yourself.
- [ ] **Go or no-go** — two equal buttons. Reversible. Both land on the trail.
- [ ] **Their sheet** — the box you write in, up to 8000 characters.
- [ ] "Start from the template" fills it with the shape: an opening line, three numbered things each with what to do and why it works for this person, a sub-bullet for where it happens, and a closing slot for which one to start with this week.
- [ ] Square brackets mark what to replace, and the screen counts how many are left, so you see an unfinished sheet before the client does.
- [ ] "How a sheet is written" lists the nine rules. The same nine go into the model's prompt, so a drafted sheet and a typed one are the same shape.
- [ ] Six address chips — Directory, Skills Hunt, Workforce, Knowledge Library, SkillUp, Foundation — so a link is right rather than remembered.
- [ ] "Draft it from the call" **(off — `DRAFT_MODEL_A_*`)**
- [ ] **The conversation** — paged twenty at a time, page number in the address. Reply, or "Draft a reply" **(off)**. Hidden when the conversation is not open.

### The work

- [ ] **The path** — "Reaching past the average" or "The smallest number". One in force, enforced by the database; changing it retires the old one rather than overwriting it.
- [ ] **Milestones** — ordered, with six states: planned, in progress, worked, changed direction, stalled, ghosted. Each takes a typed outcome.
- [ ] Actions under a milestone: open, done, dropped. A cadence of no reminder, weekly, fortnightly or monthly, and a next date.
- [ ] "Asked, still going" pushes the date out a full cycle without closing the item.
- [ ] **Work you owe them** — to do, doing, delivered, dropped. A due date, a note, and the quote it came from.
- [ ] **People to approach** — name, where, why, and five states: to approach, reached out, talking, said no, paying customer. "Said no" is a real state; the count of nos is the evidence the work happened.
- [ ] One outreach row per time somebody was actually approached: what was said, what came back.
- [ ] Marking somebody a paying customer also sets the first-customer date on the case.
- [ ] **Quotes** — a break-even floor so you do not quote under cost, the list with answer, due, paid, discount and late flags, and a form to write one. At most three outstanding at a time.
- [ ] "What is this worth" reads a model **(off — `DRAFT_MODEL_A_*`)**
- [ ] **Introductions** — by the other person's reference code, with a reason. Three outcomes: waiting, worked, went nowhere. It shows on both records, and you cannot introduce somebody to themselves.

### The account

- [ ] **Sessions bought** — every order under this person, saying plainly when nobody has signed in yet.
- [ ] **Where it ends** — the first paying customer, reversible.
- [ ] **Where this stands** — block with a reason and an optional date, unblock, close, open again. None of it reaches the client.
- [ ] **Whose session is this** — mark a record as your own test rather than a client's.
- [ ] **The record** — the event trail, newest hundred, plus a note box.

### After every write

- [ ] The screen redraws where you are. No reload, no jump to the top, and the sections you opened stay open.
- [ ] A line at the bottom says what happened, for six seconds, with **Undo** where the inverse is one real call.
- [ ] No Undo where it would be a lie: writing a row, appending text, recording a payment, or marking a session your own.

## 7. What the client sees

`/` — three states kept apart, because they are three different things to be told.

- [ ] **Signed out** — sign in with Skills Economy, and a panel for somebody who has not paid.
- [ ] **Signed in, nothing linked** — paste the claim link or just the token. This is the only place a person record is created.
- [ ] **Linked** — their sessions, each with its reference, state, call date, and the sheet with its addresses as real links.
- [ ] **Approved** — "You're a client."
- [ ] **What has been quoted to you** — agree, ask for a change, or no thanks. The last two require a reason. Only a quote still open and owned by that account can be answered.
- [ ] **The conversation** — opens on a go, or on any quote. Nothing else opens it.
- [ ] Before a decision there is no box, and after a no-go there is none — one plain sentence instead.
- [ ] The first line is scripted, stored under its own author, and labelled as scripted on both sides.
- [ ] A message from a blocked person clears the block and brings them back to your first screen.

## 8. Money

`/payments`

- [ ] Pending payments: method, amount, reference, the gift card code, submitted date.
- [ ] Confirm, or reject with one of six reasons. Either way the stored card code is destroyed.
- [ ] **Everything so far** — search by reference, twenty-five a page, with status, reason, decided date, session starts, whether a transcript exists, and the call length.

`/costs`

- [ ] **Are you underwater**, **What would close it**, week by week over eight weeks, the last seven days, and what a session costs to serve.
- [ ] **What it costs to run** — cost lines with a share percent, so a tool split three ways carries 33. A unit of month or draft-second. A demo reference is refused: testing costs are the project's.
- [ ] **What drafting actually billed** — says whether the figure came off the bill or from your typed rate. "Read the bill" **(off — `RUNPOD_API_KEY`)**
- [ ] **What is not counted** — every figure it could not work out, named rather than treated as zero.
- [ ] **Session by session** — up to 500 orders, grouped into sold, demo, and bought nothing.

## 9. Every screen, everywhere

- [ ] One phone-width column at every size, centred on anything wider. No horizontal scrolling anywhere.
- [ ] Dark only.
- [ ] A way back on the left and Refresh on the right, in one row at the top. The desk is the top of the operator side and has refresh alone.
- [ ] Nothing says it is loading. A screen is blank for a moment and then it is the page. A failure says what failed and what to do about it, where the content would have been.
- [ ] A control that starts real work disables itself and says what it is doing on itself.

## 10. Running on its own

- [ ] **(off — `SWEEP_SECRET`)** Hourly, seventeen past: fetch any missing call record, 25 a run.
- [ ] **(off — `RUNPOD_API_KEY`)** Daily, 05:41: read the drafting bill per endpoint and revise the day's figure.
- [ ] Deploy runs on a push to `main`: checks, tests, settings written from Infisical to Render, then it waits for the site to come back.
- [ ] Checks and tests run on every pull request.
- [ ] The GPU worker image is built by hand when the model changes.

## 11. Decisions you will not find a feature for

Each of these is deliberate. None is missing.

- **Nothing is ever sent.** No email, no messaging, no payment processor, no analytics. The app records what was done; reaching somebody happens elsewhere and is typed in afterwards.
- **No groups or memberships.** Two people who want the same thing get connected to each other, and it shows on both records. There is no room they join.
- **No booking a call for later.** Tabled — one-percent#50.
- **No second drafting model.** Slot B stays empty until there is one worth comparing against — one-percent#51.
- **No way for a customer to delete their own account.** Deferred on purpose, and when it is built it gets its own path: the delete that exists refuses anything not marked as demo, and widening that check would be the accident it was written to prevent.
- **Closing a case shortens your list only.** The client sees no difference, and a message from them reopens it.

---

## Every action the desk answers, and where it is above

An index, so a name read in the code can be found in the product, and so nothing new can be added
without a line here. The check in `scripts/checks.mjs` reads this list.

| Action | What it does | Section |
|---|---|---|
| `today` | the first screen's six lists | 4 |
| `queue` | one of the four tabs, paged and searchable | 5 |
| `person` | one person entire; opening it marks their messages read | 6 |
| `funnel` | both funnels in one read | 5 |
| `call-record` | the kept voice-service record for one call | 3 |
| `agent-script` | exports the voice agent's configuration | 3 |
| `decide` | go or no-go | 6 |
| `plan` | set the path in force | 6 |
| `milestone-add` | add a step to the path | 6 |
| `milestone-record` | its status and what happened | 6 |
| `action-add` | add an action under a step | 6 |
| `action-record` | close an action out with the outcome | 6 |
| `action-push` | asked, still going — push the date a full cycle | 6 |
| `quote-due` | put a date on an agreed quote | 6 |
| `quote-paid` | what arrived, when, and why it differs | 6 |
| `work-take` | take work on | 6 |
| `work-move` | move its state, with a note | 6 |
| `work-due` | set or clear its date | 6 |
| `contact-add` | somebody to approach | 6 |
| `contact-reach` | one approach: what was said, what came back | 6 |
| `contact-move` | move them along the five states | 6 |
| `reply` | write into the conversation | 6 |
| `recommend` | file the sheet | 6 |
| `draft` | ask the model for a sheet, a reply, or a recap | 6 |
| `model` | which drafting slot is in use | 6 |
| `quote` | write a quote | 6 |
| `quote-move` | move its status afterwards | 6 |
| `quote-worth` | ask the model what the work is worth | 6 |
| `introduce` | record that two people met | 6 |
| `introduction-record` | what came of it | 6 |
| `first-customer` | mark or unmark the end of the method | 6 |
| `note` | a line on the trail | 6 |
| `funnel-pool` | the size of the list being approached | 5 |
| `block` | they are waiting on somebody else | 6 |
| `unblock` | they are not any more | 6 |
| `close` | shorten your own list | 6 |
| `mine` | this record is your own test | 6 |
| `demo-seed` | make the demo records | 4 |
| `demo-clear` | delete them, refusing anything real | 4 |
