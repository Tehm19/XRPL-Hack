// routes/donate.js
import express from 'express'
import xrpl from 'xrpl'
import { db, admin } from '../firebase.js'

const router = express.Router()

// XRPL Testnet client
const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')

router.post('/help-a-bro', async (req, res) => {
  const { requestId, donorId, amount } = req.body
  const amt = parseFloat(amount)
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Invalid donation amount' })
  }

  // 1) Load donation request to get beneficiary info
  const reqRef = db.collection('donationRequests').doc(requestId)
  const reqSnap = await reqRef.get()
  if (!reqSnap.exists) {
    return res.status(404).json({ error: 'Donation request not found' })
  }
  const reqData = reqSnap.data()
  const { ownerAddress, userId: beneficiaryId } = reqData
  if (!ownerAddress || !xrpl.isValidClassicAddress(ownerAddress)) {
    return res.status(400).json({ error: 'Invalid or missing ownerAddress in request' })
  }

  try {
    // 2) Load donor's wallet from Firestore
    const walletSnap = await db.collection('wallets').doc(donorId).get()
    if (!walletSnap.exists) {
      return res.status(400).json({ error: 'Donor wallet not found' })
    }
    const donorSeed = walletSnap.data().seed
    const donorWallet = xrpl.Wallet.fromSeed(donorSeed)

    // 3) Check donor's on-chain balance
    await client.connect()
    let acctInfo = await client.request({ command: 'account_info', account: donorWallet.address, ledger_index: 'validated' })
    let balanceXRP = parseFloat(xrpl.dropsToXrp(acctInfo.result.account_data.Balance))
    if (balanceXRP < amt) {
      await client.disconnect()
      return res.status(400).json({ error: `Insufficient balance: ${balanceXRP} XRP available, needs ${amt} XRP` })
    }
    await client.disconnect()

    // 4) Record the donation and update request total
    const donationRef = await db.collection('donations').add({ requestId, donorId, amount: amt, timestamp: new Date().toISOString() })
    await reqRef.update({ donatedAmount: admin.firestore.FieldValue.increment(amt) })

    // 5) Create XRPL Escrow from donor → beneficiary
    await client.connect()
    const RIPPLE_EPOCH = 946684800
    const finishAfter = Math.floor(Date.now()/1000) - RIPPLE_EPOCH + 5 * 60
    const escCreate = {
      TransactionType: 'EscrowCreate',
      Account: donorWallet.address,
      Amount: xrpl.xrpToDrops(String(amt)),
      Destination: ownerAddress,
      FinishAfter: finishAfter + 24 * 60 * 60
    }
    const preparedC = await client.autofill(escCreate)
    const signedC = donorWallet.sign(preparedC)
    await client.submitAndWait(signedC.tx_blob)
    await client.disconnect()

    // 6) Persist escrow sequence & status
    const seq = preparedC.Sequence
    await donationRef.update({ escrowSequence: seq })
    await reqRef.update({ escrowSequence: seq, status: 'escrow_created' })

    // 7) Auto-finish escrow if goal reached
    const updatedSnap = await reqRef.get()
    const data = updatedSnap.data()
    if (data.donatedAmount >= data.estimatedAmount) {
      await client.connect()
      const escFinish = {
        TransactionType: 'EscrowFinish',
        Account: donorWallet.address,
        Owner: donorWallet.address,
        OfferSequence: seq
      }
      const preparedF = await client.autofill(escFinish)
      const signedF = donorWallet.sign(preparedF)
      const resF = await client.submitAndWait(signedF.tx_blob)
      await client.disconnect()

      // Update request status
      await reqRef.update({ status: 'funded', escrowFinishTx: resF.result.hash })
      data.status = 'funded'
      data.escrowFinishTx = resF.result.hash

      // 8) Fetch beneficiary's on-chain balance and update their Firestore wallet
      await client.connect()
      const benInfo = await client.request({ command: 'account_info', account: ownerAddress, ledger_index: 'validated' })
      await client.disconnect()
      const benBalance = parseFloat(xrpl.dropsToXrp(benInfo.result.account_data.Balance))
      // Find the beneficiary's wallet doc by userId
      const benWalletSnap = await db.collection('wallets').where('userId', '==', beneficiaryId).limit(1).get()
      if (!benWalletSnap.empty) {
        benWalletSnap.docs[0].ref.update({ balance: benBalance })
      }
    }

    return res.json({ success: true, request: data })
  } catch (e) {
    console.error('Donation error:', e)
    if (client.isConnected()) await client.disconnect()
    return res.status(500).json({ error: 'Donation failed' })
  }
})
export default router

