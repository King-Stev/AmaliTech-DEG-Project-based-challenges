'use strict';
const { createApp } = require('./app');
require('dotenv').config({"quiet":true});

const port = process.env.PORT || 3000;
const ttlMs = Number(process.env.IDEMPOTENCY_TTL_MS || 1000*60*60*24);

createApp({ ttlMs }).listen(port, () => console.log(`Idempotency Gateway listening on port ${port}`));
