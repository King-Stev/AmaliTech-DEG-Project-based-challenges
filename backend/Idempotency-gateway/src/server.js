'use strict';
const express = require('express');
require('dotenv').config({"quiet":true});

const port = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(port, () => console.log(`Idempotency Gateway listening on port ${port}`));
