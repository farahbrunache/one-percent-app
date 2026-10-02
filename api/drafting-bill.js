// The drafting bill, read on a clock.
//
// Its own address rather than an action on the cost screen's endpoint, because the caller is
// different in kind: a scheduled job proving itself with a secret, not somebody signed in. The
// cost screen has its own button for the same work, behind the ordinary admin check.

import { handle } from '../lib/http.js';
import { draftingBillSweep } from '../lib/desk-drafting-bill.js';

export default handle(['POST'], draftingBillSweep);
