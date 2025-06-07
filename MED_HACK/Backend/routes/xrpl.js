// routes/wallet.js
import express from 'express'
import xrpl from 'xrpl'
import fetch from 'node-fetch'
import { db, admin } from '../firebase.js'
import dotenv from 'dotenv'

dotenv.config()
const router = express.Router()

router.post('/wallet-create', async (req, res) => {
  try {
    const { userId } = req.body  // this is the human-readable username

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid userId' })
    }

    const newWallet = xrpl.Wallet.generate()

    const faucetRes = await fetch('https://faucet.altnet.rippletest.net/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: newWallet.address})
    })

    const faucetData = await faucetRes.json()
    if (faucetData?.account?.address !== newWallet.address) {
      return res.status(500).json({ error: 'Faucet funding failed' })
    }

    // Store with auto-generated doc ID, but include userId in the fields
    const docRef = await db.collection('wallets').add({
      address: newWallet.address,
      seed: newWallet.seed,
      userId: userId,  // the user-supplied ID
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })

    return res.json({
      firestoreId: docRef.id,       // this is the main key
      address: newWallet.address,
      userId: userId,               // user-defined name
      message: 'Wallet created and funded'
    })
  } catch (err) {
    console.error('Wallet creation failed:', err)
    return res.status(500).json({ error: 'Wallet creation failed' })
  }
})

router.get('/wallet-balance/:id', async (req, res) => {
  const { id } = req.params
  try {
    // 1. Look up the wallet doc by Firestore document ID
    const walletDoc = await db.collection('wallets').doc(id).get()
    if (!walletDoc.exists) {
      console.log('Looking up wallet ID:', id)
      return res.status(404).json({ error: 'Wallet not found' })
    }

    // 2. Extract XRP wallet address
    const { address } = walletDoc.data()
    if (!address) {
      return res.status(400).json({ error: 'Wallet document missing address field' })
    }

    // 3. Fetch on-chain balance
    const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
    await client.connect()

    const result = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated'
    })

    await client.disconnect()

    const balance = xrpl.dropsToXrp(result.result.account_data.Balance)

    // 4. Return address and balance
    return res.json({ address, balance })
  } catch (err) {
    console.error('⚠️ wallet-balance error:', err)
    return res.status(500).json({ error: 'Could not fetch balance' })
  }
})

export default router
