// The operator desk. Everything that happens after a call, for the one person running this.
//
// The payments screen is a different job and stays where it is: that one is money arriving,
// this one is a relationship being run. Keeping them apart is what stops either screen
// becoming the place where everything is done and nothing is found.
//
// The volume this is designed against is fifty thousand people and one reader. So the queue
// is paged with the page in the address, and a person's record is its own address that can
// be returned to — never one scroll holding the list and the detail together, which has no
// way back to where somebody was.

import { ensureSchema, sql } from '../lib/db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAdmin } from '../lib/auth.js';
import {
  EVENT_KINDS,
  MILESTONE_STATUSES,
  PLAN_PATHS,
  isAssessment,
  isMilestoneStatus,
  isPlanPath,
  isQueueState,
} from '../lib/desk.js';
import { HttpError, handle, readJson, send } from '../lib/http.js';

const PER_PAGE = 25;

function query(req) {
  return new URL(req.url, 'https://placeholder.invalid').searchParams;
}

function orderId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Which person?');
  return id;
}

// Written by whoever acted, read by whoever comes back to this later. The detail is optional
// and is trimmed to something a phone can show without the line becoming the screen.
async function record(id, kind, detail) {
  const text = String(detail || '').trim().slice(0, 2000);
  await sql()`
    insert into case_events (order_id, kind, detail_encrypted)
    values (${id}, ${kind}, ${text ? encrypt(text) : null})
  `;
}

function readDetail(row) {
  if (!row.detail_encrypted) return null;
  try {
    return decrypt(row.detail_encrypted);
  } catch {
    // A row written under a key that is no longer the key. The line still belongs on the
    // trail — that something happened on that date is the part that cannot be reconstructed.
    return null;
  }
}

// Three queues, derived from the assessment rather than stored beside it, so there is never a
// second fact about somebody's state that can disagree with the first.
//
// Waiting is the one with work in it: a call has been filed and nobody has read it yet.
async function queue(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const params = query(req);
  const state = isQueueState(params.get('state')) ? params.get('state') : 'waiting';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const offset = (page - 1) * PER_PAGE;

  const [rows, totals] = await Promise.all([
    sql()`
      select o.id, o.reference_code, o.call_ended_at, o.call_seconds, o.assessment,
             o.assessed_at, o.client_account_id is not null as linked,
             p.path as plan_path
        from orders o
        left join plans p on p.order_id = o.id and p.in_force
       where o.transcript_encrypted is not null
         and case ${state}
               when 'waiting' then o.assessment is null
               when 'active'  then o.assessment = 'go'
               else                o.assessment = 'no-go'
             end
       order by o.call_ended_at desc nulls last, o.id desc
       limit ${PER_PAGE} offset ${offset}
    `,
    sql()`
      select count(*)::int as n from orders o
       where o.transcript_encrypted is not null
         and case ${state}
               when 'waiting' then o.assessment is null
               when 'active'  then o.assessment = 'go'
               else                o.assessment = 'no-go'
             end
    `,
  ]);

  send(res, 200, {
    state,
    page,
    perPage: PER_PAGE,
    total: totals[0]?.n || 0,
    people: rows.map((r) => ({
      id: r.id,
      reference: r.reference_code,
      calledAt: r.call_ended_at,
      seconds: r.call_seconds,
      assessment: r.assessment,
      assessedAt: r.assessed_at,
      linked: r.linked,
      planPath: r.plan_path,
      planLabel: r.plan_path ? PLAN_PATHS[r.plan_path]?.label || r.plan_path : null,
    })),
  });
}

// One person, entire. Four queries rather than one join, because a join across events and
// milestones multiplies rows and the shapes are different enough that pulling them apart
// again costs more than asking twice.
async function person(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const id = orderId(query(req).get('id'));

  const rows = await sql()`
    select id, reference_code, status, transcript_encrypted, call_summary_encrypted,
           call_ended_at, call_seconds, assessment, assessed_at,
           client_account_id is not null as linked, approved_as_client_at
      from orders where id = ${id}
  `;
  if (!rows.length) throw new HttpError(404, 'No order with that number.');
  const row = rows[0];

  const [plans, events] = await Promise.all([
    sql()`select id, path, in_force, created_at from plans where order_id = ${id} order by created_at desc`,
    sql()`select kind, detail_encrypted, created_at from case_events where order_id = ${id} order by created_at desc limit 100`,
  ]);
  const inForce = plans.find((p) => p.in_force) || null;
  const steps = inForce
    ? await sql()`
        select id, position, title_encrypted, status, outcome_encrypted, updated_at
          from milestones where plan_id = ${inForce.id} order by position asc
      `
    : [];

  let summary = null;
  if (row.call_summary_encrypted) {
    try {
      summary = JSON.parse(decrypt(row.call_summary_encrypted));
    } catch {
      // Not the shape the voice service usually sends. The transcript is the part that
      // matters and it is right here, so this does not fail the request.
      summary = null;
    }
  }

  send(res, 200, {
    id: row.id,
    reference: row.reference_code,
    status: row.status,
    transcript: row.transcript_encrypted ? decrypt(row.transcript_encrypted) : null,
    summary,
    calledAt: row.call_ended_at,
    seconds: row.call_seconds,
    assessment: row.assessment,
    assessedAt: row.assessed_at,
    linked: row.linked,
    approvedAt: row.approved_as_client_at,
    plan: inForce
      ? { id: inForce.id, path: inForce.path, label: PLAN_PATHS[inForce.path]?.label || inForce.path, setAt: inForce.created_at }
      : null,
    formerPlans: plans
      .filter((p) => !p.in_force)
      .map((p) => ({ path: p.path, label: PLAN_PATHS[p.path]?.label || p.path, setAt: p.created_at })),
    milestones: steps.map((m) => ({
      id: m.id,
      position: m.position,
      title: decrypt(m.title_encrypted),
      status: m.status,
      outcome: m.outcome_encrypted ? decrypt(m.outcome_encrypted) : null,
      updatedAt: m.updated_at,
    })),
    events: events.map((e) => ({
      kind: e.kind,
      label: EVENT_KINDS[e.kind] || e.kind,
      detail: readDetail(e),
      at: e.created_at,
    })),
  });
}

// Go or no-go, by somebody who read the words. Changing a decision is allowed and leaves both
// on the trail; what is not allowed is a machine making it.
async function assess(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const decision = String(body.assessment || '');
  if (!isAssessment(decision)) throw new HttpError(400, 'The decision is either go or no-go.');

  const done = await sql()`
    update orders set
      assessment = ${decision},
      assessed_at = now(),
      approved_as_client_at = case
        when ${decision} = 'go' then coalesce(approved_as_client_at, now())
        else null
      end
     where id = ${id} and status = 'confirmed'
     returning id
  `;
  if (!done.length) {
    throw new HttpError(409, 'That order is not a confirmed one, so there is no call to assess.');
  }
  await record(id, 'assessed', `${decision}. ${String(body.note || '').trim()}`.trim());
  send(res, 200, { ok: true, assessment: decision });
}

// Setting the path retires whatever was in force. Two statements rather than one, because the
// partial unique index refuses two rows in force at the same moment.
async function setPlan(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const path = String(body.path || '');
  if (!isPlanPath(path)) {
    throw new HttpError(400, `Pick a path: ${Object.keys(PLAN_PATHS).join(' or ')}.`);
  }

  const exists = await sql()`select 1 from orders where id = ${id} and status = 'confirmed'`;
  if (!exists.length) throw new HttpError(404, 'No confirmed order with that number.');

  const current = await sql()`select path from plans where order_id = ${id} and in_force`;
  if (current[0]?.path === path) {
    throw new HttpError(409, 'That path is already the one in force.');
  }

  await sql()`update plans set in_force = false where order_id = ${id} and in_force`;
  await sql()`insert into plans (order_id, path) values (${id}, ${path})`;
  await record(id, 'plan.set', PLAN_PATHS[path].label);
  send(res, 200, { ok: true, path });
}

async function addMilestone(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const title = String(body.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'A milestone needs a line saying what it is.');

  const plans = await sql()`select id from plans where order_id = ${id} and in_force`;
  if (!plans.length) throw new HttpError(409, 'Set a path first — a milestone belongs to one.');

  const next = await sql()`
    select coalesce(max(position), 0) + 1 as n from milestones where plan_id = ${plans[0].id}
  `;
  await sql()`
    insert into milestones (plan_id, position, title_encrypted)
    values (${plans[0].id}, ${next[0].n}, ${encrypt(title)})
  `;
  await record(id, 'milestone.added', title);
  send(res, 201, { ok: true });
}

// What actually happened, in plain words. The status and the words are recorded together
// because a status on its own says nothing anybody can act on later.
async function recordMilestone(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const milestoneId = orderId(body.milestoneId);
  const status = String(body.status || '');
  if (!isMilestoneStatus(status)) {
    throw new HttpError(400, `Pick a status: ${MILESTONE_STATUSES.join(', ')}.`);
  }
  const outcome = String(body.outcome || '').trim().slice(0, 2000);

  const done = await sql()`
    update milestones m set
      status = ${status},
      outcome_encrypted = ${outcome ? encrypt(outcome) : null},
      updated_at = now()
     from plans p
    where m.id = ${milestoneId} and m.plan_id = p.id
      and p.order_id = ${id} and p.in_force
    returning m.id
  `;
  if (!done.length) {
    throw new HttpError(404, 'No milestone with that number under this person\'s current plan.');
  }
  await record(id, 'milestone.recorded', `${status}. ${outcome}`.trim());
  send(res, 200, { ok: true, status });
}

async function addNote(req, res) {
  requireAdmin(req);
  await ensureSchema();
  const body = await readJson(req);
  const id = orderId(body.id);
  const note = String(body.note || '').trim();
  if (!note) throw new HttpError(400, 'An empty note is not a note.');

  const exists = await sql()`select 1 from orders where id = ${id}`;
  if (!exists.length) throw new HttpError(404, 'No order with that number.');
  await record(id, 'note', note);
  send(res, 201, { ok: true });
}

const ACTIONS = {
  GET: { queue, person },
  POST: {
    assess,
    plan: setPlan,
    'milestone-add': addMilestone,
    'milestone-record': recordMilestone,
    note: addNote,
  },
};

export default handle(['GET', 'POST'], async (req, res) => {
  const action = query(req).get('action');
  const run = ACTIONS[req.method]?.[action];
  if (!run) {
    const names = Object.keys(ACTIONS[req.method] || {}).join(', ');
    throw new HttpError(400, `On ${req.method} the actions here are: ${names}.`);
  }
  return run(req, res);
});
