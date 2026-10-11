#!/usr/bin/env node
/**
 * Vault scenarios a–c (logic-level, no live UI).
 * Sign: + house owes / − player owes (same as standing_balance).
 */
'use strict';

var SETTLE_EPSILON = 0.005;

function fmt(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '');
}

function personStandingBalance(row) {
  return Math.round((Number(row && row.standing_balance) || 0) * 100) / 100;
}

function vaultTotalsFromPeople(list) {
  var owesAmt = 0, owesN = 0, owedAmt = 0, owedN = 0;
  (list || []).forEach(function (p) {
    if (!p || p.archived) return;
    var s = personStandingBalance(p);
    if (s < -SETTLE_EPSILON) { owesAmt += Math.abs(s); owesN++; }
    else if (s > SETTLE_EPSILON) { owedAmt += s; owedN++; }
  });
  return {
    owesAmt: Math.round(owesAmt * 100) / 100,
    owesN: owesN,
    owedAmt: Math.round(owedAmt * 100) / 100,
    owedN: owedN
  };
}

function applyCarryoverPrior(p, standing) {
  standing = Math.round((Number(standing) || 0) * 100) / 100;
  if (!p) return false;
  if (Math.abs(standing) <= SETTLE_EPSILON) return false;
  var already = (p.priorBalances || []).some(function (b) {
    return b && b.voided !== true && String(b.source || '').toLowerCase() === 'carryover';
  });
  if (already) return false;
  if (!p.priorBalances) p.priorBalances = [];
  p.priorBalances.push({
    amount: Math.abs(standing),
    direction: standing > 0 ? 'house-owes' : 'player-owes',
    note: 'CARRYOVER',
    source: 'carryover'
  });
  return true;
}

function addFromVault(gamePlayers, row) {
  var inGame = {};
  gamePlayers.forEach(function (p) {
    if (p && p.personId) inGame[String(p.personId)] = true;
  });
  if (inGame[String(row.id)]) return { added: false, carried: false };
  var newP = {
    id: 'p-' + row.id,
    personId: String(row.id),
    name: row.name,
    priorBalances: []
  };
  gamePlayers.push(newP);
  var carried = applyCarryoverPrior(newP, personStandingBalance(row));
  return { added: true, carried: !!carried };
}

function recordPayment(person, amount, direction) {
  amount = Math.round((Number(amount) || 0) * 100) / 100;
  var delta = direction === 'payout' ? -amount : amount;
  var opening = personStandingBalance(person);
  var closing = Math.round((opening + delta) * 100) / 100;
  person.standing_balance = closing;
  person._lastPayment = {
    kind: 'payment',
    method: 'cash',
    note: 'test',
    delta: delta,
    opening: opening,
    closing: closing
  };
  return person;
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

// ── a: 3 regulars −$500, $0, +$200 → add all → 3 added, 2 CARRYOVER ──
var peopleA = [
  { id: 'r1', name: 'ALICE', regular: true, standing_balance: -500 },
  { id: 'r2', name: 'BOB', regular: true, standing_balance: 0 },
  { id: 'r3', name: 'CARA', regular: true, standing_balance: 200 }
];
var game = [];
var added = 0, carried = 0;
peopleA.forEach(function (row) {
  var res = addFromVault(game, row);
  if (res.added) added++;
  if (res.carried) carried++;
});
assert(added === 3, 'a: expected 3 added, got ' + added);
assert(carried === 2, 'a: expected 2 CARRYOVER, got ' + carried);
assert(game.length === 3, 'a: game roster size');
console.log('a PASS: added=' + added + ' carryover=' + carried
  + ' (balances −$500, $0, +$200)');

// ── b: payment $300 from someone owing $500 → standing −$200 ──
var debtor = { id: 'd1', name: 'DAN', standing_balance: -500 };
recordPayment(debtor, 300, 'payment');
assert(personStandingBalance(debtor) === -200, 'b: standing expected −200, got ' + personStandingBalance(debtor));
assert(debtor._lastPayment.kind === 'payment', 'b: history kind payment');
assert(debtor._lastPayment.delta === 300, 'b: payment delta +300');
console.log('b PASS: standing=' + personStandingBalance(debtor)
  + ' history=Payment · cash · test (delta +' + debtor._lastPayment.delta + ')');

// ── c: totals match sum of standing balances ──
var peopleC = [
  { id: '1', standing_balance: -500, archived: false },
  { id: '2', standing_balance: 0, archived: false },
  { id: '3', standing_balance: 200, archived: false },
  { id: '4', standing_balance: -100, archived: false },
  { id: '5', standing_balance: 50, archived: true } // excluded
];
var t = vaultTotalsFromPeople(peopleC);
var sumActive = peopleC.filter(function (p) { return !p.archived; })
  .reduce(function (s, p) { return s + personStandingBalance(p); }, 0);
sumActive = Math.round(sumActive * 100) / 100;
var netFromTotals = Math.round((t.owedAmt - t.owesAmt) * 100) / 100;
assert(t.owesAmt === 600 && t.owesN === 2, 'c: owes expected $600 / 2, got $' + t.owesAmt + ' / ' + t.owesN);
assert(t.owedAmt === 200 && t.owedN === 1, 'c: owed expected $200 / 1, got $' + t.owedAmt + ' / ' + t.owedN);
assert(netFromTotals === sumActive, 'c: net totals ' + netFromTotals + ' !== sum ' + sumActive);
console.log('c PASS: Owed to house $' + fmt(t.owesAmt) + ' (' + t.owesN
  + ' people) · House owes $' + fmt(t.owedAmt) + ' (' + t.owedN
  + ' people); net=' + netFromTotals + ' matches sum of standings');

console.log('\nAll Vault scenarios a–c passed.');
