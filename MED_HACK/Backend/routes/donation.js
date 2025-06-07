import express from 'express'
import xrpl from 'xrpl'
import { db, admin } from '../firebase.js'
import dotenv from 'dotenv'


//reroll
dotenv.config()
const router = express.Router()

// XRPL Testnet client + treasury wallet
const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
const treasury = xrpl.Wallet.fromSeed("sEd7p7XXyrUFixvJpdCnhJu1mwvJGTs")

router.post('/donate', async (req, res) => {
  const { requestId, donorId='anon', amount } = req.body
  const amt = parseFloat(amount)
  const reqRef = db.collection('donationRequests').doc(requestId)

  try {
    // 1) Record the individual donation
    await db.collection('donations').add({
      requestId, donorId, amount: amt, timestamp: new Date().toISOString()
    })

    // 2) Update the running total
    await reqRef.update({
      donatedAmount: admin.firestore.FieldValue.increment(amt)
    })

    // 3) Now *create* the escrow on XRPL and save its sequence
    await client.connect()

    // difference between 1970-01-01 and 2000-01-01 in seconds
    const RIPPLE_EPOCH = 946684800;

    const finishAfter = Math.floor(Date.now()/1000) - RIPPLE_EPOCH + (5*60);

    const escCreate = {
      TransactionType: "EscrowCreate",
      Account:         treasury.address,
      Amount:          xrpl.xrpToDrops(String(amt)),
      Destination:     "rJ5ktsjEnxd1rtxXD5KWR6F4ynbfqAwwMF",
      FinishAfter:     finishAfter + 24 * 60 * 60 ,
      // (optionally) FinishAfter, CancelAfter, etc.
    }

    // This prepC.Sequence is what you must store
    const prepC   = await client.autofill(escCreate)
    const signedC = treasury.sign(prepC)
    const resC    = await client.submitAndWait(signedC.tx_blob)

    await client.disconnect()

    // Persist the escrow’s sequence number so you can finish it later
    await reqRef.update({
      escrowSequence: prepC.Sequence,
      status:         'escrow_created'
    })

    // 4) Fetch back the updated Firestore doc
    const updatedSnap = await reqRef.get()
    const data = updatedSnap.data()

    // 5) If you’ve now hit your funding target, finish the escrow
    if (data.donatedAmount >= data.estimatedAmount) {
      await client.connect()

      const escFinish = {
        TransactionType: "EscrowFinish",
        Account:         treasury.address,
        Owner:           treasury.address,
        OfferSequence:   data.escrowSequence    // <-- now defined
      }

      const prepF   = await client.autofill(escFinish)
      const signedF = treasury.sign(prepF)
      const resF    = await client.submitAndWait(signedF.tx_blob)

      await client.disconnect()

      await reqRef.update({
        status:         'funded',
        escrowFinishTx: resF.result.hash
      })
    }

    return res.json({ success: true, request: data })
  }
  catch (e) {
    console.error('Donation/escrow error:', e)
    return res.status(500).json({ error: 'Donation failed' })
  }
})

export default router

