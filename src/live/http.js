// Small helpers shared by the Kick, Twitch and YouTube checkers

const GAP = 1_000; // pause between requests to the same site within one check, to go easy on it
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An error the checker loop understands: retryAfter (ms) = how long the site asked us to wait
function httpError(site, res, retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0) {
  const err = new Error(`${site} returned HTTP ${res.status}`);
  err.retryAfter = retryAfter;
  return err;
}

module.exports = { GAP, sleep, httpError };
