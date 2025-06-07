// backend/routes/xrpl.js
import { Router } from 'express';
const router = Router();

router.get('/status', (req, res) => {
  res.json({ status: 'XRPL integration works!' });
});

export default router;
