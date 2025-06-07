import express from 'express'
import {OpenAI} from 'openai'
import dotenv from 'dotenv'

dotenv.config()
const router = express.Router()

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY})

router.post('/estimate', async (req, res) => {
  const { ocrText, insuranceName } = req.body

  try {
    const prompt = `
        You are a financial assistant. Based on the medical bill text below and the fact that the user has insurance coverage from "${insuranceName}", estimate how much the patient has to pay out-of-pocket. Reply with ONLY the estimated number in USD.

        Medical Bill:
        ${ocrText}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })

    const aiReply = completion.choices[0].message.content
    res.json({ estimatedOutOfPocket: aiReply })
  } catch (err) {
    console.error('OpenAI error:', err)
    res.status(500).json({ error: 'Failed to estimate cost' })
  }
})

export default router
