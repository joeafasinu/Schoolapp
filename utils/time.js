// Nigeria (WAT) is UTC+1 year-round - no daylight saving to worry about.
// Render's servers run in UTC by default, so we compute WAT explicitly rather than
// relying on the server's local timezone setting.

function nowInLagos() {
  const utcNow = new Date();
  return new Date(utcNow.getTime() + 60 * 60 * 1000); // +1 hour
}

function todayLagosStr() {
  return nowInLagos().toISOString().slice(0, 10);
}

// True once it's 12:00 PM (noon) or later in Lagos time, for today's date.
function isPastNoonLagos() {
  return nowInLagos().getUTCHours() >= 12; // getUTCHours on our shifted Date gives the Lagos "wall clock" hour
}

module.exports = { nowInLagos, todayLagosStr, isPastNoonLagos };
