import express from 'express'
import xrpl from 'xrpl'
import {db} from '../firebase.js'

const router = express.Router()

//release escrow
router.get('/monitor-campaign', async (req, res) => {
    const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
    await client.connect()
    try{
        const snapshot = await db.collection('donationRequests').get()

        let monitored = 0, escrowed = 0
        for (const doc of snapshot.docs){
            const data = doc.data()

            const { campaignAddress, campaignSeed, estimatedAmount, ownerAddress } = data

            if (!campaignAddress || !campaignSeed || !estimatedAmount || !ownerAddress) continue

            //get On chain Balance

            let account_info

            try {
                account_info = await client.request({
                    command: 'account_info',
                    account: campaignAddress,
                    ledger_index: 'validated'
                })
            } catch(e){
                console.error(`Failed to fetch account_info for ${campaignAddress}`)
                continue
            }
            const balance = parseFloat(xrpl.xrpToDrops(account_info.result.account_data.Balance))

            // If fully funded and not yet escrowed, create escrow
            if (balance > estimatedAmount && !data.escrowAddress) {
                const escrowWallet = xrpl.Wallet.fromSeed(campaignSeed)

                // set 24hr escrow finish
                const nowSec = Math.floor(Date.now() / 1000)
                const rippleEpoch = 946684800
                const finishAfter = nowSec - rippleEpoch + (24 * 60 * 60)


                const escrowCreate = {
                    TransactionType: 'EscrowCreate',
                    Account: campaignAddress,
                    Amount: xrpl.dropsToXrp(estimatedAmount),
                    Destination: ownerAddress,
                    FinishAfter: finishAfter
                }
                try {
                    const prepared = await client.autofill(escrowCreate)
                    const sign = escrowWallet.sign(prepared)
                    const result = await client.submitAndWait(sign.tx_blob)
                    await doc.ref.update({ 
                        escrowCreated : true,
                        escrowHash : result.result.hash,
                        escrowSequence : prepared.Sequence,
                        status : "escrow_created",
                        escrowCreatedAt: new Date().toISOString()
                    })
                    escrowed ++
                    console.log(`Escrow created for campaign ${doc.id} with hash ${result.result.hash}`)
                } catch(e){
                    console.error(`Failed to autofill escrow create for ${campaignAddress}`)
                    continue
                }
            }
        }
        monitored++
        await client.disconnect()
        res.json({monitored, escrowed, sucess:true})
    } catch(e){
        await client.disconnect()
        res.status(500).json({ error: e.toString() })
    }
})


//create escrow
router.get('/finish-escrows', async (req, res) => {
  const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233')
  await client.connect()

  let checked = 0, finished = 0
  try {
    const snapshot = await db.collection('donationRequests').get()
    const nowSec = Math.floor(Date.now() / 1000)
    const rippleEpoch = 946684800

    for (const doc of snapshot.docs) {
      const data = doc.data()
      if (!data.escrowCreated || data.escrowFinished) continue
      const { campaignAddress, campaignSeed, escrowSequence, escrowCreatedAt } = data
      if (!campaignAddress || !campaignSeed || !escrowSequence) continue

      // Compute FinishAfter (you should save it in Firestore on creation for accuracy!)
      // If you saved it:
      // const finishAfter = data.finishAfter
      // Otherwise, e.g. 24 hours after escrowCreatedAt:
      const finishAfter = Math.floor(new Date(escrowCreatedAt).getTime() / 1000) + (24 * 60 * 60) // 24h

      if (nowSec < finishAfter) continue // Not ready to release yet

      const wallet = xrpl.Wallet.fromSeed(campaignSeed)
      const finishTx = {
        TransactionType: 'EscrowFinish',
        Account: campaignAddress,
        Owner: campaignAddress,
        OfferSequence: escrowSequence
      }
      try {
        const prepared = await client.autofill(finishTx)
        const signed = wallet.sign(prepared)
        const result = await client.submitAndWait(signed.tx_blob)
        await doc.ref.update({
          escrowFinished: true,
          escrowFinishHash: result.result.hash,
          status: 'funded',
          escrowFinishedAt: new Date().toISOString()
        })
        finished++
        console.log(`Escrow finished for campaign ${doc.id}: ${result.result.hash}`)
      } catch (err) {
        console.error(`Failed to finish escrow for campaign ${doc.id}`, err)
      }
      checked++
    }
    await client.disconnect()
    res.json({ checked, finished, success: true })
  } catch (e) {
    await client.disconnect()
    res.status(500).json({ error: e.toString() })
  }
})

export default router
