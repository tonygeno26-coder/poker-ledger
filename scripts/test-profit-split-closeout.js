#!/usr/bin/env node
/**
 * Close-out step 4 — profit split scenarios a–d (logic-level).
 * Mirrors index.html closeOutAccountNet / splitProfitShares / stale gates.
 */
'use strict';

var SETTLE_EPSILON = 0.005;

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
}

function approx(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < SETTLE_EPSILON;
}

function txnIsActive(t) {
  if (!t) return false;
  if (t.voided === true) return false;
  var typ = String(t.type || '').toUpperCase();
  if (typ.indexOf('VOID') !== -1) return false;
  return true;
}

function closeOutAccountNet(p, txnLog) {
  if (!p) return 0;
  var pid = String(p.id);
  var total = 0;
  (txnLog || []).forEach(function (t) {
    if (!txnIsActive(t)) return;
    var typ = String(t.type || '').toUpperCase();
    var tid = t.personId != null && t.personId !== '' ? String(t.personId)
      : (t.playerId != null && t.playerId !== '' ? String(t.playerId) : '');
    if (tid !== pid) return;
    if (typ === 'CASH_TO_HOST' || typ === 'ECASH_TO_PERSON') {
      total -= (Number(t.amount) || 0);
    } else if (typ === 'PROFIT_TO_HOST') {
      total += (Number(t.amount) || 0);
    }
  });
  return Math.round(total * 100) / 100;
}

function splitProfitShares(profit, n) {
  var cents = Math.round((Number(profit) || 0) * 100);
  n = Math.max(1, Number(n) || 1);
  var absCents = Math.abs(cents);
  var base = Math.floor(absCents / n);
  var rem = absCents - base * n;
  var sign = cents < 0 ? -1 : 1;
  var shares = [];
  for (var i = 0; i < n; i++) {
    shares.push((sign * (base + (i === 0 ? rem : 0))) / 100);
  }
  return shares;
}

function listActiveProfitToHost(txnLog) {
  return (txnLog || []).filter(function (t) {
    return txnIsActive(t) && String(t.type || '').toUpperCase() === 'PROFIT_TO_HOST';
  });
}

function isCloseOutProfitDone(state) {
  if (state.profitSplitStale) return false;
  return listActiveProfitToHost(state.txnLog).length > 0;
}

function isGameFullyClosedOut(state) {
  return !!(state.chipsDone && state.ecashDone && state.cashDone && isCloseOutProfitDone(state));
}

function markProfitSplitStale(state) {
  if (!listActiveProfitToHost(state.txnLog).length) return;
  state.profitSplitStale = true;
}

// ── a: One host Gary, cash $4,620, profit $1,500 → Gary −$3,120 ──
(function () {
  var gary = { id: 'gary', name: 'GARY', staffRole: 'host' };
  var log = [
    { type: 'CASH_TO_HOST', personId: 'gary', amount: 4620 },
    { type: 'PROFIT_TO_HOST', personId: 'gary', amount: 1500 }
  ];
  var shares = splitProfitShares(1500, 1);
  assert(approx(shares[0], 1500), 'a share');
  var bal = closeOutAccountNet(gary, log);
  assert(approx(bal, -3120), 'a Gary account expected −3120 got ' + bal);
  console.log('a PASS: Gary cash 4620 + profit 1500 → account ' + bal);
})();

// ── b: Two hosts, $1,500 → $750 each; $1,000.01 → $500.01 / $500.00 ──
(function () {
  var s1 = splitProfitShares(1500, 2);
  assert(approx(s1[0], 750) && approx(s1[1], 750), 'b even 1500');
  var s2 = splitProfitShares(1000.01, 2);
  assert(approx(s2[0], 500.01) && approx(s2[1], 500), 'b leftover got ' + s2.join(','));
  var derek = { id: 'derek' };
  var gary = { id: 'gary' };
  var log = [
    { type: 'PROFIT_TO_HOST', personId: 'gary', amount: s1[0] },
    { type: 'PROFIT_TO_HOST', personId: 'derek', amount: s1[1] }
  ];
  assert(approx(closeOutAccountNet(gary, log), 750), 'b gary +750');
  assert(approx(closeOutAccountNet(derek, log), 750), 'b derek +750');
  console.log('b PASS: 1500→750/750; 1000.01→' + s2[0] + '/' + s2[1]);
})();

// ── c: Loss −$300, two hosts → each −$150 ──
(function () {
  var s = splitProfitShares(-300, 2);
  assert(approx(s[0], -150) && approx(s[1], -150), 'c shares ' + s.join(','));
  var log = [
    { type: 'PROFIT_TO_HOST', personId: 'gary', amount: s[0] },
    { type: 'PROFIT_TO_HOST', personId: 'derek', amount: s[1] }
  ];
  assert(approx(closeOutAccountNet({ id: 'gary' }, log), -150), 'c gary');
  assert(approx(closeOutAccountNet({ id: 'derek' }, log), -150), 'c derek');
  console.log('c PASS: loss −300 → each −150');
})();

// ── d: Buy-in after step 4 → stale, End Game blocked ──
(function () {
  var state = {
    chipsDone: true,
    ecashDone: true,
    cashDone: true,
    profitSplitStale: false,
    txnLog: [
      { type: 'PROFIT_TO_HOST', personId: 'gary', amount: 1500 }
    ]
  };
  assert(isGameFullyClosedOut(state) === true, 'd pre buy-in fully closed');
  // Non-close-out txn (buy-in) marks profit stale — same hook as markChipReconcileStale
  markProfitSplitStale(state);
  assert(state.profitSplitStale === true, 'd stale flag');
  assert(isCloseOutProfitDone(state) === false, 'd profit not done');
  assert(isGameFullyClosedOut(state) === false, 'd End Game blocked');
  console.log('d PASS: buy-in after step 4 → profit stale → End Game blocked');
})();

console.log('All profit-split close-out tests a–d passed.');
