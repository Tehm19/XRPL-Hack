// routes/analyze-and-estimate.js
import express from 'express'
import multer from 'multer'
import vision from '@google-cloud/vision'
import { OpenAI } from 'openai'
import dotenv from 'dotenv'
import { db } from '../firebase.js'
import xrpl from 'xrpl'


dotenv.config()
const router = express.Router()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY})

const upload = multer({ dest: 'uploads/' })
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: './keys/google-vision.json'
})

router.post('/analyze-and-estimate', upload.single('file'), async (req, res) => {
  console.log('🛠️  /analyze-and-estimate invoked')
  console.log('req.file =', req.file)
  console.log('req.body =', req.body)

  if (!req.file) {
    return res.status(400).json({ error: 'No file received' })
  }

  // Pull dynamically provided ownerAddress & userId
  const insuranceName = req.body.insuranceName?.trim() || 'None'
  const ownerAddress  = req.body.ownerAddress?.trim()
  const userId        = req.body.userId?.trim() || 'anon'

  // Validate the beneficiary address
  if (!ownerAddress || !xrpl.isValidClassicAddress(ownerAddress)) {
    return res.status(400).json({ error: 'Invalid or missing ownerAddress' })
  }

  try {
    // 1) OCR
    const [result] = await visionClient.documentTextDetection(req.file.path)
    const fullText = result.fullTextAnnotation?.text || ''

    if (!fullText) {
      return res.status(400).json({ error: 'No text detected in image' })
    }

    // Convert to word blocks with average X/Y
    const wordBlocks = result.textAnnotations.slice(1).map(w => {
      const ys = w.boundingPoly.vertices.map(v => v.y || 0)
      const xs = w.boundingPoly.vertices.map(v => v.x || 0)
      return {
        text: w.description,
        avgY: ys.reduce((sum, y) => sum + y, 0) / ys.length,
        avgX: xs.reduce((sum, x) => sum + x, 0) / xs.length
      }
    })

    // Group into rows by Y proximity
    const rows = []
    wordBlocks.sort((a, b) => a.avgY - b.avgY).forEach(wb => {
      const existing = rows.find(r => Math.abs(r.avgY - wb.avgY) < 10)
      if (existing) {
        existing.words.push(wb)
        existing.avgY = (existing.avgY * (existing.words.length - 1) + wb.avgY) / existing.words.length
      } else {
        rows.push({ avgY: wb.avgY, words: [wb] })
      }
    })

    // Build ordered lines
    const structuredLines = rows.map(r =>
      r.words.sort((a, b) => a.avgX - b.avgX).map(w => w.text).join(' ')
    )
    
    //use gpt to check image
    const prompt = `
      You are a billing assistant. From the medical bill or invoice text below, extract ONLY the final amount the recipient is required to pay. Look for labels such as "Balance Due", "Amount Due", "Total Due", "Amount Payable", or similar.

      - If there are multiple totals, choose the **Balance Due** or **Amount Due** as the final payable amount.
      - Ignore subtotals, discounts, amounts already paid, and taxes unless they are the only possible line.
      - Output only the amount (e.g., "USD 8,480.00" or "$8,480.00"), nothing else.

      Medical Bill:
      ${fullText}
      `
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
      const aiReply = completion.choices[0].message.content.trim()

    // 3) extract amount if required

    let finalAmount = null
    const numMatch = aiReply.match(/(\$|USD)?\s*([\d,]+(\.\d{2})?)/i)
    if (numMatch) {
      finalAmount = numMatch[0].replace(/[^0-9.]/g, '')  // "8480.00"
    }

    // 4) Determine final estimated value
    const estimatedAmountValue = finalAmount
      ? parseFloat(finalAmount.replace(/[^\d.]/g, ''))
      : parseFloat(aiReply.replace(/[^\d.]/g, '')) || 0

    //4.5 Generate a new wallet for this campaign/request
    const campaignWallet = xrpl.Wallet.generate()
    const campaignAddress = campaignWallet.address
    const campaignSeed = campaignWallet.seed // store securely, never expose to public/frontend

    // 5) Save to Firestore with dynamic ownerAddress
    const data = {
      userId,
      ownerAddress,
      billText: fullText,
      insuranceName,
      estimatedAmount: estimatedAmountValue,
      donatedAmount: 0,
      createdAt: new Date().toISOString(),
      campaignAddress,
      campaignSeed
    }

    console.log('Saving to Firestore:', data)
    let docRef
    if (db.collection) {
      docRef = await db.collection('donationRequests').add(data)
    } else {
      docRef = await addDoc(collection(db, 'donationRequests'), data)
    }
    console.log('Firestore doc created:', docRef.id)

    return res.json({
      extractedText: fullText,
      estimatedOutOfPocket: finalAmount || aiReply || '0',
      requestId: docRef.id
    })

  } catch (err) {
    console.error('GPT + OCR Error:', err)
    return res.status(500).json({ error: 'Failed to process document and estimate cost' })
  }
})

export default router


