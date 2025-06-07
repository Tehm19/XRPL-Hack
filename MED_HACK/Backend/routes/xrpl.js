
import express from 'express'
import xrpl from 'xrpl'
import dotenv from 'dotenv'
const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ status: 'XRPL integration works!' });
});

export default router;
