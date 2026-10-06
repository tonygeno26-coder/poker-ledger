/* Lightweight checks for durable auth client rules (no network). */
var PB_REFRESH_SKEW_MS = 5 * 60 * 1000;

function needsRefresh(expiresAt, now) {
  if (!expiresAt) return true;
  var t = new Date(expiresAt).getTime();
  if (isNaN(t)) return true;
  return t - now <= PB_REFRESH_SKEW_MS;
}

function balanceQueueToast(hasToken) {
  if (!hasToken) return 'Not signed in — balances saved on this phone';
  return 'Balances not posted — tap to retry';
}

var now = Date.now();
var cases = [
  [new Date(now + 60 * 1000).toISOString(), true, '1min'],
  [new Date(now + 4 * 60 * 1000).toISOString(), true, '4min'],
  [new Date(now + 6 * 60 * 1000).toISOString(), false, '6min'],
  [new Date(now - 1000).toISOString(), true, 'expired'],
  [null, true, 'null']
];

var pass = 0;
var fail = 0;
cases.forEach(function (c) {
  var got = needsRefresh(c[0], now);
  if (got === c[1]) {
    pass++;
    console.log('PASS', c[2]);
  } else {
    fail++;
    console.log('FAIL', c[2], 'got', got);
  }
});

var toast = balanceQueueToast(false);
if (toast.indexOf('offline') >= 0) {
  fail++;
  console.log('FAIL offline wording');
} else if (toast.indexOf('Not signed in') < 0) {
  fail++;
  console.log('FAIL missing not-signed-in toast');
} else {
  pass++;
  console.log('PASS no-offline wording');
}

console.log('counts pass=' + pass + ' fail=' + fail);
if (fail) process.exit(1);
