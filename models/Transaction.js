const { db } = require('../db/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { createClientForCredentials } = require('../services/interledgerClient');
const { isFinalizedGrant, OpenPaymentsClientError } = require('@interledger/open-payments');
const User = require('./User');

class Transaction {
  static collection() {
    return db.collection('transactions');
  }

  /**
   * Create a transaction using Interledger Open Payments
   */
  static async create(fromWalletId, toWalletId, amount, description) {
    if (amount <= 0) throw new Error('Amount must be positive');

    const fromWallet = await Wallet.findByUserId(fromWalletId);
    const toWallet = await Wallet.findByUserId(toWalletId);

    if (!fromWallet || !toWallet) {
      throw new Error('Wallet not found');
    }

    if (!fromWallet.wallet_address_url || !toWallet.wallet_address_url) {
      throw new Error('Wallet addresses not configured for ILP payments');
    }

    try {
      const fromUser = await User.findById(fromWalletId);
      const toUser = await User.findById(toWalletId);

      const senderKeyId = fromUser?.ilp_key_id || process.env.ILP_KEY_ID;
      const senderKeyPath = fromUser?.ilp_private_key_path || process.env.ILP_PRIVATE_KEY_PATH || undefined;
      const senderWalletUrl = fromWallet.wallet_address_url || process.env.ILP_WALLET_ADDRESS_URL;

      const receiverKeyId = toUser?.ilp_key_id || process.env.ILP_KEY_ID;
      const receiverKeyPath = toUser?.ilp_private_key_path || process.env.ILP_PRIVATE_KEY_PATH || undefined;
      const receiverWalletUrl = toWallet.wallet_address_url || process.env.ILP_WALLET_ADDRESS_URL;

      // Validate key files if paths provided
      const fs = require('fs');
      if (receiverKeyPath && !fs.existsSync(receiverKeyPath)) {
        throw new Error(`Receiver private key file not found at path: ${receiverKeyPath}`);
      }

      console.log('Creating receiver ILP client', { receiverWalletUrl, receiverKeyId, receiverKeyPath });
      const receiverClient = await createClientForCredentials({ walletAddressUrl: receiverWalletUrl, keyId: receiverKeyId, privateKeyPath: receiverKeyPath });

      const receiverWalletAddress = await receiverClient.walletAddress.get({ url: receiverWalletUrl });
      const incomingGrant = await receiverClient.grant.request(
        { url: receiverWalletAddress.authServer },
        { access_token: { access: [ { type: 'incoming-payment', actions: ['read', 'complete', 'create'] } ] } }
      );

      if (!isFinalizedGrant(incomingGrant)) throw new Error('Failed to get incoming payment grant');

      // Create incoming payment (tolerate validation errors by accepting response body)
      let incomingPayment;
      try {
        incomingPayment = await receiverClient.incomingPayment.create(
          { url: receiverWalletAddress.resourceServer, accessToken: incomingGrant.access_token.value },
          { walletAddress: receiverWalletAddress.id, incomingAmount: { assetCode: receiverWalletAddress.assetCode, assetScale: receiverWalletAddress.assetScale, value: amount.toString() } }
        );
      } catch (err) {
        if (err instanceof OpenPaymentsClientError && err.response && err.response.data) {
          console.warn('incomingPayment validation failed but response body present - accepting response data');
          incomingPayment = err.response.data;
        } else {
          throw err;
        }
      }

      // Sender client and quote
      if (senderKeyPath && !require('fs').existsSync(senderKeyPath)) {
        throw new Error(`Sender private key file not found at path: ${senderKeyPath}`);
      }
      console.log('Creating sender ILP client', { senderWalletUrl, senderKeyId, senderKeyPath });
      const senderClient = await createClientForCredentials({ walletAddressUrl: senderWalletUrl, keyId: senderKeyId, privateKeyPath: senderKeyPath });

      const senderWalletAddress = await senderClient.walletAddress.get({ url: senderWalletUrl });

      const quoteGrant = await senderClient.grant.request(
        { url: senderWalletAddress.authServer },
        { access_token: { access: [ { type: 'quote', actions: ['create', 'read'] } ] } }
      );

      if (!isFinalizedGrant(quoteGrant)) throw new Error('Failed to get quote grant');

      const quote = await senderClient.quote.create(
        { url: senderWalletAddress.resourceServer, accessToken: quoteGrant.access_token.value },
        { walletAddress: senderWalletAddress.id, receiver: incomingPayment.id, method: 'ilp' }
      );

      const outgoingGrant = await senderClient.grant.request(
        { url: senderWalletAddress.authServer },
        { access_token: { access: [ { type: 'outgoing-payment', actions: ['read', 'create'], limits: { debitAmount: quote.debitAmount }, identifier: senderWalletAddress.id } ] }, interact: { start: ['redirect'] } }
      );

      const txRef = this.collection().doc();
      await txRef.set({
        from_wallet_id: fromWalletId,
        to_wallet_id: toWalletId,
        amount,
        description: description || '',
        status: 'pending_grant',
        incoming_payment_id: incomingPayment.id,
        quote_id: quote.id,
        grant_continue_uri: outgoingGrant.continue?.uri,
        grant_continue_token: outgoingGrant.continue?.access_token?.value,
        grant_interact_url: outgoingGrant.interact?.redirect,
        created_at: FieldValue.serverTimestamp(),
      });

      return { success: false, requiresInteraction: true, interactUrl: outgoingGrant.interact.redirect, transactionId: txRef.id, message: 'Please authorize the payment by visiting the provided URL' };
    } catch (err) {
      console.error('ILP transaction error:', err);
      if (err.response) {
        try { console.error('Open Payments response data:', err.response.data || err.response); } catch (e) { console.error('Error printing response', e); }
      }
      throw new Error(`Payment failed: ${err.message}`);
    }
  }

  static async completePendingTransaction(transactionId) {
    const txDoc = await this.collection().doc(transactionId).get();
    if (!txDoc.exists) throw new Error('Transaction not found');

    const txData = txDoc.data();
    if (txData.status !== 'pending_grant') throw new Error('Transaction is not pending grant approval');

    try {
      const fromWallet = await Wallet.findByUserId(txData.from_wallet_id);
      const fromUser = await User.findById(txData.from_wallet_id);
      const senderKeyId = fromUser?.ilp_key_id || process.env.ILP_KEY_ID;
      const senderKeyPath = fromUser?.ilp_private_key_path || process.env.ILP_PRIVATE_KEY_PATH || undefined;
      const senderWalletUrl = fromWallet.wallet_address_url || process.env.ILP_WALLET_ADDRESS_URL;

      const senderClient = await createClientForCredentials({ walletAddressUrl: senderWalletUrl, keyId: senderKeyId, privateKeyPath: senderKeyPath });

      const finalizedGrant = await senderClient.grant.continue({ url: txData.grant_continue_uri, accessToken: txData.grant_continue_token });
      if (!isFinalizedGrant(finalizedGrant)) throw new Error('Grant not approved');

      const senderWalletAddress = await senderClient.walletAddress.get({ url: senderWalletUrl });

      const outgoingPayment = await senderClient.outgoingPayment.create(
        { url: senderWalletAddress.resourceServer, accessToken: finalizedGrant.access_token.value },
        { walletAddress: senderWalletAddress.id, quoteId: txData.quote_id }
      );

      await txDoc.ref.update({ status: 'completed', outgoing_payment_id: outgoingPayment.id, completed_at: FieldValue.serverTimestamp() });
      return true;
    } catch (err) {
      await txDoc.ref.update({ status: 'failed', error_message: err.message });
      throw err;
    }
  }

  static async getByWalletId(walletId) {
    const fromSnap = await this.collection().where('from_wallet_id', '==', walletId).orderBy('created_at', 'desc').get();
    const toSnap = await this.collection().where('to_wallet_id', '==', walletId).orderBy('created_at', 'desc').get();
    const items = [];
    fromSnap.forEach(d => items.push({ id: d.id, ...d.data() }));
    toSnap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => { const at = a.created_at?.toMillis?.() || 0; const bt = b.created_at?.toMillis?.() || 0; return bt - at; });
    return items;
  }

  static async getAll() {
    const snap = await this.collection().orderBy('created_at', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

module.exports = Transaction;
