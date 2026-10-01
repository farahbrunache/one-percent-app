// The minutes a session bought, and what happens when a start does not come back.
//
// Out of lib/db.js because that file is the schema and these are not: they are the rules about
// a voice call -- whether one came back, how much of the half hour is spent, what a start that
// connected to nothing costs. The schema says what a row looks like; this says what the rows
// mean.

import { sql } from './db.js';
import { encrypt } from './crypto.js';
import { noteCallSpend } from './spend.js';

// Minutes already spent against an order. A call still running counts as the whole budget, and
// a call that started long enough ago to have finished but was never heard about counts as a
// full session — a webhook that goes missing must not turn into free voice time.
// Whether a call against this order came back with words in it.
//
// A session is spent by being had, not by using up its minutes. The sales page says a call
// ends when the questions are answered and that a short call is a finished one rather than a
// cut-off one, so a conversation that ran four minutes and produced a transcript is the
// product, delivered. Counting only minutes left somebody who had their call able to start
// another on the same seven dollars -- including somebody who had already been told no.
//
// A transcript is what tells the two cases apart. A start that never connected, or dropped
// before anybody spoke, leaves a row with nothing in it, and that is the case the restarts
// exist for.
export async function aCallCameBack(orderId) {
  const rows = await sql()`
    select 1 from calls
     where order_id = ${orderId} and transcript_encrypted is not null
     limit 1
  `;
  return rows.length > 0;
}

export async function secondsSpent(orderId, assumeFullAfter, budget, unreportedAfter) {
  // Refused rather than defaulted. A missing figure here becomes a comparison against null,
  // which is neither true nor false, so the rule it belongs to quietly stops applying and the
  // answer looks reasonable while being wrong. That is what happened when one caller was
  // updated and another was not.
  for (const [name, value] of [
    ['assumeFullAfter', assumeFullAfter],
    ['budget', budget],
    ['unreportedAfter', unreportedAfter],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`secondsSpent needs ${name} as a number, and was given ${value}.`);
    }
  }

  const rows = await sql()`
    select coalesce(sum(
      case
        when seconds is not null then seconds
        -- Checked before the two guesses below, because those describe a call that may still
        -- be running and this one describes a call that cannot be.
        when started_at < now() - ${unreportedAfter} * interval '1 second' then 0
        when started_at < now() - ${assumeFullAfter} * interval '1 second' then ${assumeFullAfter}
        else ${budget}
      end
    ), 0)::int as used
      from calls where order_id = ${orderId}
  `;
  return Number(rows[0]?.used || 0);
}

// Counts the attempts back from what they produced.
//
// The order's attempt counter is written when a session starts and given back when the voice
// service refuses, but nothing gives it back when the browser fails to join -- and a counter
// that only goes up closes the order after three presses that never connected anybody to
// anything. That is what happened: an order with no conversation against it reporting that
// its sessions had been used.
//
// So the counter is derived rather than accumulated. What counts as an attempt is a call that
// exists, was not given back at zero, and is recent enough to be real. Everything else was a
// button press, and a button press is not a session.
//
// The window clock is reset with it. It exists so an order is not held open forever, and it
// should start when a session does, not when somebody first pressed a button that failed.
export async function reconcileStarts(orderId, unreportedAfter) {
  await sql()`
    update orders o set
      session_starts = coalesce(counted.attempts, 0),
      first_started_at = counted.began
    from (
      select
        count(*)::int as attempts,
        min(started_at) as began
      from calls
       where order_id = ${orderId}
         and (seconds is null or seconds > 0)
         and started_at > now() - ${unreportedAfter} * interval '1 second'
    ) as counted
    where o.id = ${orderId}
  `;
}

// Keeps what the voice service holds, before their seven days run out.
//
// Called when a call ends and again when it is analyzed, because the later event carries more,
// and from the desk, so a call made before this existed can still be caught in time.
//
// It never fails the caller. A webhook that cannot reach the voice service has still delivered
// a transcript, and refusing it would make the service retry a delivery that already landed.
export async function keepRecord(callId, record) {
  const rows = await sql()`
    update calls set record_encrypted = ${record}, record_taken_at = now()
      where call_id = ${callId}
    returning id
  `;
  if (!rows.length) return false;

  // The charge, written where it will outlive the call.
  await noteCallSpend(callId);
  return true;
}

// The page saying the session never connected. Only a call that started moments ago, and only
// one nothing has been written against: a call with a transcript happened, whatever the page
// believes, and a call from an hour ago is not one somebody is failing to join right now.
export async function abandonCall(orderId, callId, withinSeconds) {
  const rows = await sql()`
    update calls set seconds = 0, ended_at = now()
      where order_id = ${orderId}
        and call_id = ${callId}
        and seconds is null
        and transcript_encrypted is null
        and started_at > now() - ${withinSeconds} * interval '1 second'
    returning id
  `;
  return rows.length > 0;
}
