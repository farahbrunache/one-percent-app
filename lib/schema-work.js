// The tables for what happens after a go: the path, its milestones, the actions under them, and
// the people somebody is going to approach.
//
// Out of lib/db.js because that file passed its size limit. It is one subject -- everything here
// hangs off a plan or a case and describes work in progress, as against an order, a call or a
// payment, which are the facts of a purchase.
//
// Takes the same tagged template `ensureSchema` uses, so every statement here obeys the same
// rule: safe to run twice, because this runs on every cold start rather than once at deploy.

export async function workTables(q) {
  // Which of the two paths is in force. A change writes a new row and retires the old one, so
  // the path somebody was on in March is still readable in June.
  await q`
    create table if not exists plans (
      id         bigserial   primary key,
      order_id   bigint      not null references orders (id) on delete cascade,
      path       text        not null,
      in_force   boolean     not null default true,
      created_at timestamptz not null default now()
    )
  `;
  await q`create index if not exists plans_order_idx on plans (order_id, created_at desc)`;
  await q`alter table if exists plans add column if not exists case_id bigint references cases (id)`;
  await q`create index if not exists plans_case_idx on plans (case_id, created_at desc)`;
  // One plan in force per person, enforced by the database rather than by remembering to.
  // Per order while nobody has signed in, and per case once somebody has -- two orders under
  // one person are one relationship and cannot be walking two paths at once.
  await q`create unique index if not exists plans_in_force_idx on plans (order_id) where in_force`;

  // The steps under a plan. The title and the outcome are both somebody's situation in plain
  // words, so both are encrypted.
  await q`
    create table if not exists milestones (
      id                bigserial   primary key,
      plan_id           bigint      not null references plans (id) on delete cascade,
      position          integer     not null,
      title_encrypted   text        not null,
      status            text        not null default 'planned',
      outcome_encrypted text,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now()
    )
  `;
  await q`create index if not exists milestones_plan_idx on milestones (plan_id, position)`;

  // The things somebody actually has to do, under the milestone they belong to.
  //
  // A milestone is where the work is headed. It is too big to pick up on a Tuesday, so it sat
  // on the record as a heading with nothing under it and the actual next move lived in the
  // owner's head. These are that move, written down: one line each, closed out with what
  // happened in plain words rather than a status alone.
  //
  // `next_at` is what makes the cadence do something. A step somebody is working through needs
  // asking about again, and remembering to ask is the part that fails. So the row carries the
  // date it comes back, the morning screen reads it, and closing the item stops it.
  //
  // The title and the outcome are both somebody's situation in plain words, so both are
  // encrypted, the same as the milestone above them.
  await q`
    create table if not exists action_items (
      id                bigserial   primary key,
      milestone_id      bigint      not null references milestones (id) on delete cascade,
      position          integer     not null,
      title_encrypted   text        not null,
      status            text        not null default 'open',
      cadence           text        not null default 'none',
      next_at           timestamptz,
      outcome_encrypted text,
      closed_at         timestamptz,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now()
    )
  `;
  await q`create index if not exists action_items_milestone_idx
            on action_items (milestone_id, position)`;
  // The morning screen asks one question of this table: what is due. Open items only, because a
  // closed one has no date left on it.
  await q`create index if not exists action_items_due_idx
            on action_items (next_at) where status = 'open' and next_at is not null`;

  // The people somebody is going to approach, and what happened when they did.
  //
  // The method ends at a first paying customer, and a first paying customer is a person
  // somebody spoke to. Until now the sheet could say "pick three people to approach this week"
  // and there was nowhere to put the three names, so the one list that leads to the only
  // outcome this product measures lived in somebody's head.
  //
  // Keyed to the case rather than an order, like the quotes and the conversation: two orders
  // under one person are one relationship, and their list of people does not fork when they buy
  // a second call.
  //
  // Every column that holds words is encrypted. A name here is a real person who never agreed
  // to anything -- they are somebody a client mentioned, not a member, not a user, and not
  // somebody this app has any relationship with at all.
  await q`
    create table if not exists contacts (
      id             bigserial   primary key,
      case_id        bigint      not null references cases (id) on delete cascade,
      name_encrypted text        not null,
      where_encrypted text,
      why_encrypted  text,
      status         text        not null default 'to approach',
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    )
  `;
  await q`create index if not exists contacts_case_idx on contacts (case_id, created_at)`;
  // A pointer into the Skills Economy Directory, sealed. Only the id: the person's details are
  // read live on the desk and never stored here (lib/desk-directory.js).
  await q`alter table if exists contacts add column if not exists directory_profile_encrypted text`;

  // One row per time somebody was actually reached out to.
  //
  // Separate from the contact's status because a status is where it got to and this is what
  // happened on the way. Somebody approached three times over a month and somebody approached
  // once read identically from a status alone, and the difference is the thing worth knowing
  // when the sheet is written.
  //
  // The app records this. It never sends it: the message goes out on Quora, Signal, or in a
  // shop, and what came back is typed in here. That gap is on purpose and nothing in this table
  // should ever grow a send button.
  await q`
    create table if not exists outreach (
      id           bigserial   primary key,
      contact_id   bigint      not null references contacts (id) on delete cascade,
      at           timestamptz not null default now(),
      said_encrypted text,
      back_encrypted text,
      created_at   timestamptz not null default now()
    )
  `;
  await q`create index if not exists outreach_contact_idx on outreach (contact_id, at desc)`;

  // Work the operator owes somebody.
  //
  // Everything else on a record is work the client owes themselves: the path, the steps, the
  // people to approach. The one thing nobody was tracking is the other direction. Somebody
  // agrees to four hundred dollars for a rate card, pays it, and the quote says agreed and paid
  // while nothing anywhere says whether the rate card was ever written.
  //
  // So a project is a piece of work taken on, with a state and a date. A paid quote with no
  // project against it is money taken for something nobody is tracking, and the screen says so.
  //
  // `quote_id` is optional: not every piece of work was quoted, and a quote is a price rather
  // than a promise. `on delete set null` so withdrawing a quote does not delete the work.
  await q`
    create table if not exists projects (
      id              bigserial   primary key,
      case_id         bigint      not null references cases (id) on delete cascade,
      quote_id        bigint      references quotes (id) on delete set null,
      title_encrypted text        not null,
      state           text        not null default 'to do',
      due_at          timestamptz,
      delivered_at    timestamptz,
      note_encrypted  text,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    )
  `;
  await q`create index if not exists projects_case_idx on projects (case_id, created_at)`;
  // The morning screen asks one question of this table: what is late. Undelivered only, because
  // a delivered project has no date left to miss.
  await q`create index if not exists projects_due_idx
            on projects (due_at) where delivered_at is null and due_at is not null`;
}
