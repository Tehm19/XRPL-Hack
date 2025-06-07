// backend/index.js
import express from 'express';
import cors from 'cors';
import xrplRoutes from './routes/xrpl.js';
import ocrRoutes from './routes/ocr.js'
import donateRoutes from './routes/donation.js'

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Basic API check
app.get('/', (req, res) => {
  res.send('MED_HACK backend running!');
});

// XRPL related routes
app.use('/xrpl', xrplRoutes);
app.use('/ocr', ocrRoutes)
app.use('/donate', donateRoutes)
app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
