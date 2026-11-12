'use strict';
const express = require('express');
const { IdempotencyStore, fingerprint } = require('./store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createApp({ processingDelayMs = 2000,  sweepMs } = {}) {
  const app = express();
  const store = new IdempotencyStore({ sweepMs });
  app.locals.store = store;
  app.use(express.json());

  // Malformed JSON -> clean 400 instead of an HTML stack trace
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    next(err);
  });

  // The "payment processor" (simulated)
  async function processPayment({ amount, currency }) {
    await sleep(processingDelayMs);
    return { status: 201, body: { status: 'success', message: `Charged ${amount} ${currency}` } };
  }

  function send(res, { status, body }, cacheHit) {
    if (cacheHit) res.set('X-Cache-Hit', 'true');
    return res.status(status).json(body);
  }

  // Payment processing
  app.post('/process-payment', async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || !key.trim() || key.length > 255) {
      return res.status(400).json({ error: 'Idempotency-Key header is required (1-255 characters).' });
    }

    const { amount, currency } = req.body || {};
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
        typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
      return res.status(400).json({ error: 'Body must include a positive numeric "amount" and a 3-letter "currency".' });
    }

    const fp = fingerprint({ amount, currency: currency.toUpperCase() });
    const existing = store.get(key);

    if (existing) {
      // Same key, different payload -> reject
      if (existing.fingerprint !== fp) {
        return res.status(409).json({ error: 'Idempotency key already used for a different request body.' });
      }
      // In-flight: wait for the original request to finish
      if (existing.state === 'processing') {
        try {
          const response = await existing.promise;
          return send(res, response, true);
        } catch (e) {
          return res.status(500).json({ error: 'Original request failed. Please retry.' });
        }
      }
      // Completed: replay saved response 
      return send(res, existing.response, true);
    }

    // First time we see this key
    // startProcessing runs synchronously right after get(), so no other request can slip in between
    const promise = processPayment({ amount, currency: currency.toUpperCase() });
    store.startProcessing(key, fp, promise);
    try {
      const response = await promise;
      store.complete(key, response);
      return send(res, response, false);
    } catch (e) {
      store.remove(key); // failures are not cached, so the client may safely retry
      return res.status(500).json({ error: 'Payment processing failed. Please retry.' });
    }
  });

  // Health check
  app.get('/health', (req, res) => res.json({ ok: true }));
  return app;
}

module.exports = { createApp };
