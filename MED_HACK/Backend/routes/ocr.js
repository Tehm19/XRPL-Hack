import express from 'express'
import multer from 'multer'
import vision from '@google-cloud/vision'
import {OpenAI} from 'openai'
import dotenv from 'dotenv'

dotenv.config()
const router = express.Router()
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY})

const upload = multer({ dest: 'uploads/' })

const visionclient = new vision.ImageAnnotatorClient({
  keyFilename: './keys/google-vision.json'
})

router.post('/analyze-and-estimate', upload.single('file'), async (req, res) => {
  const insuranceName = req.body.insuranceName?.trim() || "None"

  try {
    // step1: ocr calculate
    const [result] = await visionclient.documentTextDetection(req.file.path)
    const fullText = result?.fullTextAnnotation.text || ''
    
     if (!fullText) {
      return res.status(400).json({ error: 'No text detected in image' })
    }

    // Step 2: Bill Estimation
    const prompt = `
      You are a financial assistant. Your job is to analyze the medical bill text and estimate how much the patient must still pay out-of-pocket.

      The user has reported their insurance company as: "${insuranceName}".

      Please follow these steps:

      1. If the insurance name is "None" or left empty, **assume the user did not specify** because the bill may already show what insurance covered.

      2. Carefully analyze the bill for lines like:
        - "Insurance paid"
        - "Amount due"
        - "You owe"
        - "Patient responsibility"
        If such a line is present, use the value provided — it reflects what the patient owes **even if no insurance was specified manually**.

      3. If the insurance name is provided, check whether it's a real, known U.S. insurer. If it looks fake or unrecognized, say:
        "Unknown insurance provider. Cannot estimate cost."

      4. If no final due amount is listed in the bill, and the insurance is valid, estimate based on typical coverage rates (e.g. 70–90%).

      Respond in this format:

      ---
      [Reasoning]

      Final Estimated Out-of-Pocket Cost: $X.XX
      ---

      Medical Bill:
      ${fullText}
      `

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })

    const aiReply = completion.choices[0].message.content.trim()

    res.json({
      extractedText: fullText,
      estimatedOutOfPocket: aiReply
    })

  } catch (error) {
    console.error('GPT + OCR Error:', error)
    res.status(500).json({ error: 'Failed to process document and estimate cost' })
  }
})

export default router
