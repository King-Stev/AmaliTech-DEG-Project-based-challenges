'use strict';
const crypto = require('crypto');

// Deterministic JSON: sorts object keys so {a:1,b:2} and {b:2,a:1} hash the same
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(body) {
  return crypto.createHash('sha256').update(canonicalize(body)).digest('hex');
}

// In-memory idempotency store with TTL expiry (Developer's Choice feature)
class IdempotencyStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, sweepMs = 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this.timer = setInterval(() => this.sweep(), sweepMs);
    this.timer.unref(); // never keep the process alive just for cleanup
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Expired completed entries are treated as non-existent (lazy expiry)
    if (entry.state === 'completed' && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  // Synchronous set: JS is single-threaded, so check+set in the same tick is atomic
  startProcessing(key, fp, promise) {
    this.entries.set(key, { fingerprint: fp, state: 'processing', promise, response: null, expiresAt: null });
  }

  complete(key, response) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.state = 'completed';
    entry.response = response;
    entry.expiresAt = Date.now() + this.ttlMs;
  }

  remove(key) { this.entries.delete(key); }

  sweep() {
    const now = Date.now();
    for (const [key, e] of this.entries) {
      if (e.state === 'completed' && e.expiresAt <= now) this.entries.delete(key);
    }
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { IdempotencyStore, fingerprint };
