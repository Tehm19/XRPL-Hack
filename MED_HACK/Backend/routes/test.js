// routes/test.js
import express from 'express';
import { db } from '../firebase.js';

const router = express.Router();

router.get('/test-firestore', async (req, res) => {
  try {
    const docRef = db.collection('test').doc('ping');
    await docRef.set({ alive: true, timestamp: Date.now() });

    const doc = await docRef.get();
    res.json({ message: 'Success!', data: doc.data() });
  } catch (error) {
    console.error('Firestore error:', error);
    res.status(500).json({ error: 'Failed to access Firestore' });
  }
});

export default router;
