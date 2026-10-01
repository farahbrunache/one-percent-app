// Demo records, made on production beside the real ones.
//
// There is no second instance and there is not going to be one. Two environments is two things
// to deploy, two databases to migrate and two sets of settings to keep in step, for one person.
// So the product gets tested where it runs, and what makes that safe is the flag: a record is
// marked when it is made and never afterwards, the screens show a chip on it, and the one thing
// that deletes records refuses anything without the mark.
//
// The numbers get skewed while they are here. That is accepted -- the flag means excluding them
// from a figure later is one predicate in one query.
//
// Every scenario below exercises a path the desk has. When a feature lands, the row that tests
// it lands with it, in the same change, or the feature is untestable on the only instance there
// is.
//
// Nothing here resembles a real person. The transcripts are invented, the names are invented,
// and every reference code starts DEMO so it is recognizable before the chip is even read.

import { sql } from './db.js';
import { encrypt, keyedHash } from './crypto.js';

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// A reference the same shape as a real one -- ten characters with a dash in the middle -- and
// unmistakable at a glance.
function demoReference(n) {
  return `DEMO${String(n).padStart(1, '0')}-${'ABCDEFGHJK'[n % 10].repeat(5)}`.slice(0, 11);
}

// Invented words. A real transcript is somebody's trade, their rate and half an hour of their
// life, and none of that belongs in a fixture on a public repository or in a seeded row.
const TRANSCRIPTS = {
  plumber:
    'Agent: What do you do?\nCaller: Plumbing. I am an apprentice, going for my license.\n'
    + 'Agent: What would you charge?\nCaller: I have no idea what to ask for.\n'
    + 'Agent: Who would your first customer be?\nCaller: I do not know anybody who would hire me.',
  teacher:
    'Agent: What do you do?\nCaller: Early childhood education.\n'
    + 'Agent: What would you charge?\nCaller: I used to be salaried, so I have never set a rate.\n'
    + 'Agent: Who would your first customer be?\nCaller: I would want to teach remotely first.',
  driver:
    'Agent: What do you do?\nCaller: I drive, and I am good with engines.\n'
    + 'Agent: What would you charge?\nCaller: Whatever is fair for the run.\n'
    + 'Agent: Who would your first customer be?\nCaller: Anybody who needs a load moved.',
};

async function makeOrder(n, { status = 'confirmed' } = {}) {
  const rows = await sql()`
    insert into orders (claim_token_hash, card_code_hash, card_amount_cents, payment_method,
                        reference_code, status, is_demo, created_at)
    values (${keyedHash(`demo-claim-${n}-${Date.now()}`)},
            ${keyedHash(`demo-card-${n}-${Date.now()}`)},
            700, 'wise', ${demoReference(n)}, ${status}, true, ${hoursAgo(72)})
    returning id
  `;
  return Number(rows[0].id);
}

async function makeCall(orderId, words, endedHoursAgo, { kind = 'intake', seconds = 240 } = {}) {
  await sql()`
    insert into calls (order_id, call_id, kind, seconds, transcript_encrypted,
                       started_at, ended_at, record_encrypted, record_taken_at)
    values (${orderId}, ${`demo-call-${orderId}`}, ${kind}, ${seconds}, ${encrypt(words)},
            ${hoursAgo(endedHoursAgo + 0.1)}, ${hoursAgo(endedHoursAgo)},
            ${encrypt(JSON.stringify({ demo: true, call_cost: { combined_cost: 0.58 } }))},
            ${hoursAgo(endedHoursAgo)})
  `;
}

async function makeCase(orderId, account) {
  const rows = await sql()`
    insert into cases (account_id, is_demo) values (${account}, true)
    on conflict (account_id) do update set account_id = excluded.account_id
    returning id
  `;
  const caseId = Number(rows[0].id);
  await sql()`update orders set client_account_id = ${account}, case_id = ${caseId}
               where id = ${orderId}`;
  return caseId;
}

async function say(account, author, body, hoursBack) {
  await sql()`
    insert into messages (account_id, author, body_encrypted, created_at)
    values (${account}, ${author}, ${encrypt(body)}, ${hoursAgo(hoursBack)})
  `;
}

// One of each thing the desk can be looking at. Returns what it made, so the screen can say so
// rather than saying it worked.
export async function seedDemo() {
  const made = [];
  const stamp = Date.now().toString(36).slice(-4);
  let n = 0;
  const next = () => (n += 1);

  // 1. Paid, never called. Interest and nothing else -- no case, no person.
  const paidOnly = await makeOrder(next());
  made.push({ reference: demoReference(n), is: 'paid, never called' });

  // 2. A call past the twenty-four hour target with no decision. This is what the first screen
  //    exists to shout about.
  const late = await makeOrder(next());
  await makeCall(late, TRANSCRIPTS.plumber, 31);
  made.push({ reference: demoReference(n), is: 'called 31 hours ago, no decision' });

  // 3. A call inside the target. Same list, no alarm.
  const fresh = await makeOrder(next());
  await makeCall(fresh, TRANSCRIPTS.driver, 3);
  made.push({ reference: demoReference(n), is: 'called 3 hours ago, no decision' });

  // 4. A go, with a sheet, a case, a plan, milestones and a conversation. The working client.
  const working = await makeOrder(next());
  await makeCall(working, TRANSCRIPTS.plumber, 96);
  const workingCase = await makeCase(working, `demo-acct-working-${stamp}`);
  await sql()`
    update orders set decision = 'go', decision_at = ${hoursAgo(90)},
                      approved_as_client_at = ${hoursAgo(90)},
                      recommendations_encrypted = ${encrypt(
                        'Three things. Ask for a rate per job rather than per hour. Pick three '
                        + 'people to approach this week. Write down what each one says.')},
                      recommendations_written_at = ${hoursAgo(89)}
     where id = ${working}
  `;
  const plan = await sql()`
    insert into plans (order_id, case_id, path, created_at)
    values (${working}, ${workingCase}, 'smallest', ${hoursAgo(88)})
    returning id
  `;
  await sql()`
    insert into milestones (plan_id, position, title_encrypted, status, outcome_encrypted)
    values (${plan[0].id}, 1, ${encrypt('Approach three people')}, 'worked',
            ${encrypt('One said yes, one said later, one did not answer.')}),
           (${plan[0].id}, 2, ${encrypt('Set a rate per job')}, 'in progress', null)
  `;
  await say(`demo-acct-working-${stamp}`, 'opening',
    'What do you make of the recommendations? And would you like help following them through?', 88);
  await say(`demo-acct-working-${stamp}`, 'client', 'The per-job rate makes sense. I tried it.', 80);
  await say(`demo-acct-working-${stamp}`, 'operator', 'Good. What did they say to the number?', 79);
  made.push({ reference: demoReference(n), is: 'a go, with a plan, milestones and a conversation' });

  // 5. A no-go who was quoted anyway, and who then wrote in. This pairing broke the desk once:
  //    a quote opens the conversation, and the queue that surfaces messages only asked about go.
  const quotedNoGo = await makeOrder(next());
  await makeCall(quotedNoGo, TRANSCRIPTS.teacher, 120);
  const quotedCase = await makeCase(quotedNoGo, `demo-acct-quoted-${stamp}`);
  await sql()`
    update orders set decision = 'no-go', decision_at = ${hoursAgo(118)},
                      recommendations_encrypted = ${encrypt(
                        'Teaching remotely is the fastest way to earn while the rest is worked out.')},
                      recommendations_written_at = ${hoursAgo(117)}
     where id = ${quotedNoGo}
  `;
  await sql()`
    insert into quotes (account_id, amount_cents, scope_encrypted, status, created_at)
    values (${`demo-acct-quoted-${stamp}`}, 45000,
            ${encrypt('Set up a remote teaching practice: rates, a schedule, and the first three parents.')},
            'offered', ${hoursAgo(40)})
  `;
  await say(`demo-acct-quoted-${stamp}`, 'client', 'Can we talk about the timing on that quote?', 26);
  made.push({ reference: demoReference(n), is: 'a no-go who was quoted, and wrote in 26 hours ago' });

  // 6. Two orders under one person. A case is a person; an order is one purchase.
  const firstBuy = await makeOrder(next());
  await makeCall(firstBuy, TRANSCRIPTS.driver, 400);
  const returningCase = await makeCase(firstBuy, `demo-acct-returning-${stamp}`);
  await sql()`
    update orders set decision = 'go', decision_at = ${hoursAgo(398)},
                      approved_as_client_at = ${hoursAgo(398)},
                      recommendations_encrypted = ${encrypt('Start with one regular run a week.')},
                      recommendations_written_at = ${hoursAgo(397)}
     where id = ${firstBuy}
  `;
  const secondBuy = await makeOrder(next());
  await makeCall(secondBuy, TRANSCRIPTS.driver, 50, { kind: 'follow-up', seconds: 900 });
  await sql()`update orders set client_account_id = ${`demo-acct-returning-${stamp}`},
                                case_id = ${returningCase} where id = ${secondBuy}`;
  made.push({ reference: demoReference(n), is: 'a second session under the same person' });

  // Drafting against the working client, so the cost screen has both halves of what a session
  // costs rather than only what the call charged. One that came back and one that was given up
  // on: the second is the row that was invisible until it was written at submit, and it is the
  // one worth seeing on a screen about money.
  await sql()`
    insert into drafts (order_id, slot, model, job_id, prompt_tokens, completion_tokens,
                        seconds, finished_at, created_at)
    values (${working}, 'A', 'demo-model', 'demo-job-1', 1800, 400, 12,
            ${hoursAgo(87)}, ${hoursAgo(87)})
  `;
  await sql()`
    insert into drafts (order_id, slot, model, job_id, created_at, gave_up_at)
    values (${working}, 'A', 'demo-model', 'demo-job-2', ${hoursAgo(86)}, ${hoursAgo(85.99)})
  `;

  // 7. A blocked thread. It is off the first screen until its date passes, and it comes back
  //    carrying how long it sat.
  const blocked = await makeOrder(next());
  await makeCall(blocked, TRANSCRIPTS.teacher, 200);
  const blockedCase = await makeCase(blocked, `demo-acct-blocked-${stamp}`);
  await sql()`
    update orders set decision = 'go', decision_at = ${hoursAgo(198)},
                      approved_as_client_at = ${hoursAgo(198)},
                      recommendations_encrypted = ${encrypt('Find out what the license actually requires.')},
                      recommendations_written_at = ${hoursAgo(197)}
     where id = ${blocked}
  `;
  await say(`demo-acct-blocked-${stamp}`, 'client', 'Did you hear back about the license?', 60);
  await sql()`
    update cases set messages_read_at = ${hoursAgo(58)},
                     blocked_at = ${hoursAgo(58)},
                     blocker_encrypted = ${encrypt('Waiting on the licensing board to answer.')}
     where id = ${blockedCase}
  `;
  made.push({ reference: demoReference(n), is: 'blocked, waiting on somebody else' });

  return made;
}

// Every demo record, gone. Refuses anything without the mark, and the refusal is the safety
// property rather than the filter -- so the deletes below name the flag in their own where
// clause rather than trusting a list of ids gathered a moment earlier.
export async function clearDemo() {
  const accounts = await sql()`select account_id from cases where is_demo`;
  const names = accounts.map((r) => r.account_id);

  // Keyed to an account rather than to an order, so they are not reached by the cascade.
  for (const account of names) {
    await sql()`delete from messages where account_id = ${account}`;
    await sql()`delete from quotes where account_id = ${account}`;
  }

  // Calls, plans, milestones, events and introductions all hang off an order or a plan with
  // `on delete cascade`, so the orders take them.
  const orders = await sql()`delete from orders where is_demo returning id`;
  const cases = await sql()`delete from cases where is_demo returning id`;

  return { orders: orders.length, cases: cases.length, messagesFor: names.length };
}
