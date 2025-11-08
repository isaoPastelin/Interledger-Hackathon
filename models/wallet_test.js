const { createAuthenticatedClient, OpenPaymentsClientError, isFinalizedGrant } = require('@interledger/open-payments');
const path = require('path');
const User = require('../models/User');

const { db } = require('../db/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { send } = require('process');


class Wallet {

    static async create(userId){
        const user = await User.findById(userId);
        if(!user){
            throw new Error('User not found');
        }
        if(!user.wallet_address_url){
            throw new Error('User does not have a wallet address URL set');
        }

        const client = await createAuthenticatedClient({
            walletAddressUrl: user.wallet_address_url,
            keyId: user.ilp_key_id,
            privateKey: user.ilp_private_key_path
        })
        return client;
    }

    static async getWalletAddress(userId){
        const client = await this.create(userId);
        return await client.walletAddress.get({ url: client.walletAddressUrl});
    }

    /**
     * Orchestrate a payment from one user to another up to the interactive grant step.
     * Returns the interact URL and continuation data so the caller can approve the grant.
     */
    static async pay(fromUserId, toWalletAddressUrl, amount){
        if (amount <= 0) throw new Error('Amount must be positive');


        // Receiver: resolve wallet by wallet id and create client using the wallet's owner credentials
        const toWallet = toWalletAddressUrl;
        if (!toWallet) throw new Error('Target wallet not found');
        
        const receiverClient = await this.create(receiverUserId);
        const receiverWalletUrl = toWallet.wallet_address_url;
        const receiverWalletAddress = await receiverClient.walletAddress.get({ url: receiverWalletUrl });

        const incomingGrant = await receiverClient.grant.request(
            { url: receiverWalletAddress.authServer },
            { access_token: { access: [ { type: 'incoming-payment', actions: ['read','complete','create'] } ] } }
        );

        if (!isFinalizedGrant(incomingGrant)) throw new Error('Failed to obtain incoming payment grant for receiver');

        const incomingPayment = await receiverClient.incomingPayment.create(
            { url: receiverWalletAddress.resourceServer, accessToken: incomingGrant.access_token.value },
            { walletAddress: receiverWalletAddress.id, incomingAmount: { assetCode: receiverWalletAddress.assetCode, assetScale: receiverWalletAddress.assetScale, value: amount.toString() } }
        );

        // Sender: create quote
        const senderClient = await this.create(fromUserId);
        const senderUser = await User.findById(fromUserId);
        const senderWalletUrl = senderUser.wallet_address_url;
        const senderWalletAddress = await senderClient.walletAddress.get({ url: senderWalletUrl });

        const quoteGrant = await senderClient.grant.request(
            { url: senderWalletAddress.authServer },
            { access_token: { access: [ { type: 'quote', actions: ['create','read'] } ] } }
        );

        if (!isFinalizedGrant(quoteGrant)) throw new Error('Failed to obtain quote grant for sender');

        const quote = await senderClient.quote.create(
            { url: senderWalletAddress.resourceServer, accessToken: quoteGrant.access_token.value },
            { walletAddress: senderWalletAddress.id, receiver: incomingPayment.id, method: 'ilp' }
        );

        // Request outgoing (interactive) grant
        const outgoingGrant = await senderClient.grant.request(
            { url: senderWalletAddress.authServer },
            {
                access_token: {
                    access: [
                        { type: 'outgoing-payment', actions: ['read','create'], limits: { debitAmount: quote.debitAmount }, identifier: senderWalletAddress.id }
                    ]
                },
                interact: { start: ['redirect'] }
            }
        );

        return {
            interactUrl: outgoingGrant.interact?.redirect,
            continueUri: outgoingGrant.continue?.uri,
            continueToken: outgoingGrant.continue?.access_token?.value,
            incomingPaymentId: incomingPayment.id,
            quoteId: quote.id
        };
    }

    /**
     * Complete an interactive payment after the user has approved the grant (by visiting interactUrl).
     * Returns the outgoing payment resource.
     */
    static async completePayment(fromUserId, continueUri, continueToken, quoteId){
        const senderClient = await this.create(fromUserId);
        const senderUser = await User.findById(fromUserId);
        const senderWalletUrl = senderUser.wallet_address_url;
        const senderWalletAddress = await senderClient.walletAddress.get({ url: senderWalletUrl });

        const finalizedGrant = await senderClient.grant.continue({ url: continueUri, accessToken: continueToken });
        if (!isFinalizedGrant(finalizedGrant)) throw new Error('Grant not finalized/approved');

        const outgoingPayment = await senderClient.outgoingPayment.create(
            { url: senderWalletAddress.resourceServer, accessToken: finalizedGrant.access_token.value },
            { walletAddress: senderWalletAddress.id, quoteId }
        );

        return outgoingPayment;
    }

    



}

module.exports = Wallet;