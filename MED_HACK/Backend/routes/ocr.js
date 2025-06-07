import express from 'express'
import multer from 'multer'
import vision from '@google-cloud/vision'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })
const client = new vision.ImageAnnotatorClient({
  keyFilename: './keys/google-vision.json'
})

router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    const [result] = await client.documentTextDetection(req.file.path)
    const fullText = result.fullTextAnnotation.text
    res.json({ extractedText: fullText })
  } catch (error) {
    console.error('OCR Error:', error)
    res.status(500).json({ error: 'Failed to Process document' })
  }
})

export default router
