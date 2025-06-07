import express from 'express'
import multer from 'multer'
import vision from '@google-cloud/vision'
import { OpenAI } from 'openai'
import dotenv from 'dotenv'
import { db } from '../firebase.js'
import xprl from 'xrpl'
// If using modular Firestore client SDK, uncomment:
// import { collection, addDoc } from 'firebase/firestore'

dotenv.config()
const router = express.Router()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

  const insuranceName = req.body.insuranceName?.trim() || 'None'

  try {
    // 1) OCR
    const [result] = await visionClient.documentTextDetection(req.file.path)
    const fullText = result.fullTextAnnotation?.text || ''

    if (!fullText) {
      return res.status(400).json({ error: 'No text detected in image' })
    }

    console.log(`\n===== OCR Raw TextAnnotations (first 5) =====`)
    console.log(result.textAnnotations.slice(0,5).map(a => a.description))
    console.log('===========================================\n')

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

    console.log(`Found ${wordBlocks.length} word blocks`)    
    wordBlocks.slice(0, 10).forEach((wb,i) =>
      console.log(i, wb.text, `Y:${wb.avgY.toFixed(1)}`, `X:${wb.avgX.toFixed(1)}`)
    )

    // Group into rows by Y proximity
    const rows = []
    wordBlocks.sort((a,b) => a.avgY - b.avgY).forEach(wb => {
      const existing = rows.find(r => Math.abs(r.avgY - wb.avgY) < 10)
      if (existing) {
        existing.words.push(wb)
        existing.avgY = (existing.avgY * (existing.words.length - 1) + wb.avgY) / existing.words.length
      } else {
        rows.push({ avgY: wb.avgY, words: [wb] })
      }
    })

    console.log(`\n===== Row grouping =====`)
    rows.forEach((r,i) => {
      console.log(`Row ${i} (Y:${r.avgY.toFixed(1)}) ->`,
        r.words.map(w => w.text).join(' | ')
      )
    })

    // Build ordered lines
    const structuredLines = rows.map(r =>
      r.words
        .sort((a,b) => a.avgX - b.avgX)
        .map(w => w.text)
        .join(' ')
    )

    console.log(`\n===== Structured Lines =====`)
    structuredLines.forEach((l, i) => console.log(`${i}:`, l))
    console.log('===========================\n')

    // 2) Extract due line
    const patterns = [
      /PLEASE\s+PAY\s+THIS\s+AMOUNT[:]?/i,
      /AMOUNT\s+DUE[:]?/i,
      /PATIENT\s+RESPONSIBILITY[:]?/i,
      /YOU\s+OWE[:]?/i,
      /TOTAL[:]?/i
    ]
    const dueLine = structuredLines.find(line => patterns.some(rx => rx.test(line)))
    console.log('Matched dueLine:', dueLine)

    let finalAmount = null
    if (dueLine) {
      const m = dueLine.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/)
      if (m) finalAmount = m[0].startsWith('$') ? m[0] : '$' + m[1]
    }

    // 3) Fallback to AI if no OCR match
    let aiReply = null
    if (!finalAmount) {
      console.warn('No OCR match, using AI fallback')
      const prompt = `
You are a billing assistant. From the medical bill text below, extract the exact amount the patient needs to pay out-of-pocket. Ignore total charges and insurance payments.

Medical Bill:
${fullText}
`
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
      aiReply = completion.choices[0].message.content.trim()
      console.log('AI reply:', aiReply)
    }

    // 4) Determine final estimated value
     const estimatedAmountValue = finalAmount
      ? parseFloat(finalAmount.replace(/[^\d.]/g, ''))
      : parseFloat(aiReply.replace(/[^\d.]/g, '')) || 0

    // Save to Firestore
    const data = {
      userId: 'demo-user',
      billText: fullText,
      insuranceName,
      estimatedAmount: estimatedAmountValue,
      donatedAmount: 0,
      status: 'active',
      createdAt: new Date().toISOString()
    }

    console.log('Saving to Firestore:', data)
    let docRef
    try {
      if (db.collection) {
        // Admin SDK or compat
        docRef = await db.collection('donationRequests').add(data)
      } else {
        // Modular v9 client
        docRef = await addDoc(collection(db, 'donationRequests'), data)
      }
      console.log('Firestore doc created:', docRef.id)
    } catch (dbErr) {
      console.error('Firestore save failed:', dbErr)
      return res.status(500).json({ error: 'Failed to save to database' })
    }

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

