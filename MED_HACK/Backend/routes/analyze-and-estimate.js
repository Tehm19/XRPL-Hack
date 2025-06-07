import xrpl from 'xrpl'
// … inside your handler, after db.collection('donationRequests').add(...)
await client.connect()

// amount in drops (1 XRP = 1 000 000 drops)
const drops = xrpl.xrpToDrops(estimatedAmount) 

const escCreate = {
  TransactionType: "EscrowCreate",
  Account: treasury.address,
  Destination: process.env.XRPL_HOSPITAL_ADDRESS,
  Amount: drops,
  // allow finish after 1 hour, cancel after 1 week
  FinishAfter: Math.floor(Date.now()/1000 + 3600),
  CancelAfter: Math.floor(Date.now()/1000 + 604800),
}

const prepared = await client.autofill(escCreate)
const signed   = treasury.sign(prepared)
const result   = await client.submitAndWait(signed.tx_blob)
await client.disconnect()

// save the escrow sequence & hash on your request doc
await db.collection('donationRequests').doc(docRef.id).update({
  escrowTxHash:    result.result.hash,
  escrowSequence:  result.result.Sequence
})
