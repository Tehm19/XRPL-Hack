// backend/index.js
import express from 'express';
import cors from 'cors';
import xrplRoutes from './routes/xrpl.js';
import ocrRoutes from './routes/ocr.js'
import escrowRoutes from './routes/monitor_wallet.js'
import cron from 'node-cron'
import { monitorAndCreateEscrow ,  finishEscrows} from './routes/monitor_wallet.js'


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Basic API check
app.get('/', (req, res) => {
  res.send('MED_HACK backend running!');
});


// Run monitor every minute
cron.schedule('* * * * *', async () => {
  console.log('[CRON] Running monitorAndCreateEscrow...')
  await monitorAndCreateEscrow()
})

// Run escrow finisher every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[CRON] Running finishEscrows...')
  await finishEscrows()
})

// XRPL related routes
app.use('/xrpl', xrplRoutes);
app.use('/ocr', ocrRoutes)
app.use('/api', escrowRoutes)


app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
