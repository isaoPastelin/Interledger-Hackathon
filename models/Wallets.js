const { createAuthenticatedClient, OpenPaymentsClientError, isFinalizedGrant } = require('@interledger/open-payments');
const path = require('path');
const fs = require('fs');
const User = require('./User');

const readline = require('readline/promises');

const { db } = require('../db/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { send } = require('process');
const { exec } = require('child_process');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class Wallet {

    static async create(userId){
        const user = await User.findById(userId);
        if(!user){
            throw new Error('User not found');
        }
        if(!user.wallet_address_url){
            throw new Error('User does not have a wallet address URL set');
        }

        // Resolve async getters (they may return promises)
        const walletAddressUrl = await User.getWalletAddress(userId);
        const keyId = await User.getIlpKey(userId);
        let privateKeyOrPath = await User.getIlpPrivateKeyPath(userId);

        // If the user object already included the path, prefer it
        if (!privateKeyOrPath && user.ilp_private_key_path) {
          privateKeyOrPath = user.ilp_private_key_path;
        }

        // Resolve private key material: if it's a path, read the PEM contents
        let privateKeyMaterial = privateKeyOrPath;
        if (typeof privateKeyOrPath === 'string' && !privateKeyOrPath.includes('-----BEGIN')) {
          try {
            if (fs.existsSync(privateKeyOrPath)) {
              privateKeyMaterial = fs.readFileSync(privateKeyOrPath, 'utf8');
            } else {
              // leave as-is; the client may accept paths or raw PEM
              privateKeyMaterial = privateKeyOrPath;
            }
          } catch (err) {
            console.error('Error reading ILP private key file:', err.message || err);
          }
        }

        const client = await createAuthenticatedClient({
            walletAddressUrl,
            keyId,
            privateKey: privateKeyMaterial,
        })
        return client;
    }

    /**
     * Orchestrate a payment from one user to another up to the interactive grant step.
     * Returns the interact URL and continuation data so the caller can approve the grant.
     */
    static async pay(fromUserId, toWalletAddressUrl, amount){
        if (amount <= 0) throw new Error('Amount must be positive');
        
        const client = await this.create(fromUserId);

        const SENDING_WALLET_ADDRESS_URL = await User.getWalletAddress(fromUserId)
        const RECEIVING_WALLET_ADDRESS_URL = toWalletAddressUrl
        console.log(toWalletAddressUrl)
        
        const sendingWalletAddress = await client.walletAddress.get({
            url: SENDING_WALLET_ADDRESS_URL
        })
        const receivingWalletAddress = await client.walletAddress.get({
            url: RECEIVING_WALLET_ADDRESS_URL
        })
        console.log('\nStep 1: got sending and receiving wallet addresses', {
            sendingWalletAddress,
            receivingWalletAddress
        })
        const incomingPaymentGrant = await client.grant.request(
            {
                url: receivingWalletAddress.authServer
            },
            {
                access_token: {
                    access: [
                    {
                        type: 'incoming-payment',
                        actions: ['read', 'complete', 'create']
                    }
                    ]
                }
                }
            )
        if (!isFinalizedGrant(incomingPaymentGrant)) {
          throw new Error('Expected finalized incoming payment grant')
        }
    console.log('\nStep 2: got incoming payment grant on receiving wallet address', {
    incomingPaymentGrant
  })
  
  // Step 3: Create the incoming payment. This will be where funds will be received.

    const incomingPayment = await client.incomingPayment.create(
      {
        url: receivingWalletAddress.resourceServer,
        accessToken: incomingPaymentGrant.access_token.value
      },
    {
      walletAddress: receivingWalletAddress.id,
      incomingAmount: {
        assetCode: receivingWalletAddress.assetCode,
        assetScale: receivingWalletAddress.assetScale,
        value: amount.toString()
      },
      expiresAt: new Date(Date.now() + 60_000 * 10 ).toISOString() // 1 hour from now
    }
  );

  console.log(
    '\nStep 3: created incoming payment on receiving wallet address',
    incomingPayment
  )

  // Step 4: Get a quote grant, so we can create a quote on the sending wallet address
  const quoteGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer
    },
    {
      access_token: {
        access: [
          {
            type: 'quote',
            actions: ['create', 'read']
          }
        ]
      }
    }
  )

  if (!isFinalizedGrant(quoteGrant)) {
    throw new Error('Expected finalized quote grant')
  }

  console.log('\nStep 4: got quote grant on sending wallet address', quoteGrant)

  // Step 5: Create a quote, this gives an indication of how much it will cost to pay into the incoming payment
  const quote = await client.quote.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: quoteGrant.access_token.value
    },
    {
      walletAddress: sendingWalletAddress.id,
      receiver: incomingPayment.id,
      method: 'ilp'
    }
  )

  console.log('\nStep 5: got quote on sending wallet address', quote)

  // Step 7: Start the grant process for the outgoing payments.
  // This is an interactive grant: the user (in this case, you) will need to accept the grant by navigating to the outputted link.
  const outgoingPaymentGrant = await client.grant.request(
    {
      url: sendingWalletAddress.authServer
    },
    {
      access_token: {
        access: [
          {
            type: 'outgoing-payment',
            actions: ['read', 'create'],
            limits: {
              debitAmount: {
                assetCode: quote.debitAmount.assetCode,
                assetScale: quote.debitAmount.assetScale,
                value: quote.debitAmount.value
              }
            },
            identifier: sendingWalletAddress.id
          }
        ]
      },
      interact: {
        start: ['redirect'],
        //
        // finish: {
        // method: "redirect",
        // //   // This is where you can (optionally) redirect a user to after going through interaction.
        // //   // Keep in mind, you will need to parse the interact_ref in the resulting interaction URL,
        // //   // and pass it into the grant continuation request.
        //    uri: "http://localhost:3000/dashboard",
        //    nonce: crypto.randomUUID(),
        // },
      }
    }
  )

  console.log(
    '\nStep 7: got pending outgoing payment grant',
    outgoingPaymentGrant
  )
  console.log(
    'Please navigate to the following URL, to accept the interaction from the sending wallet:'
  )
  console.log(outgoingPaymentGrant.interact.redirect)
// open the interact URL in the default browser (acts like a popup)
    const url = outgoingPaymentGrant.interact.redirect;

    const cmd =
        process.platform === 'win32'
            ? `start "" "${url}"`
            : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;

    exec(cmd, (err) => {
        if (err) {
            console.error('Could not open browser. Please open this URL manually:', url);
        } else {
            console.log('Opened browser to approve grant:', url);
        }
    });

    console.log('\nPlease accept grant in the browser. This script will automatically continue in 20 seconds...');

  // Wait for 20,000 milliseconds
  await wait(20000);

  console.log('20-second wait complete. Continuing script...');

  let finalizedOutgoingPaymentGrant

  const grantContinuationErrorMessage =
    '\nThere was an error continuing the grant. You probably have not accepted the grant at the url (or it has already been used up, in which case, rerun the script).'

console.error('a')
  try {
    finalizedOutgoingPaymentGrant = await client.grant.continue({
      url: outgoingPaymentGrant.continue.uri,
      accessToken: outgoingPaymentGrant.continue.access_token.value
    })
  } catch (err) {
    if (err instanceof OpenPaymentsClientError) {
      console.log(grantContinuationErrorMessage)
      process.exit()
    }

    throw err
  }

  if (!isFinalizedGrant(finalizedOutgoingPaymentGrant)) {
    console.log(
      'There was an error continuing the grant. You probably have not accepted the grant at the url.'
    )
    process.exit()
  }

  console.log(
    '\nStep 6: got finalized outgoing payment grant',
    finalizedOutgoingPaymentGrant
  )

  // Step 7: Finally, create the outgoing payment on the sending wallet address.
  // This will make a payment from the outgoing payment to the incoming one (over ILP)
  const outgoingPayment = await client.outgoingPayment.create(
    {
      url: sendingWalletAddress.resourceServer,
      accessToken: finalizedOutgoingPaymentGrant.access_token.value
    },
    {
      walletAddress: sendingWalletAddress.id,
      quoteId: quote.id
    }
  )

  console.log(
    '\nStep 7: Created outgoing payment. Funds will now move from the outgoing payment to the incoming payment.',
    outgoingPayment
  )

//   process.exit()
    }
  static async request(fromUserId, toWalletAddressUrl, amount){
        // Implementation for requesting money can go here


    }


}

module.exports = Wallet;