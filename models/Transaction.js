/**
 * Script COMPLETO para consultar TODAS las transacciones (recibidas y enviadas)
 * Incluye flujo interactivo para outgoing payments
 */

const { isFinalizedGrant, isPendingGrant, OpenPaymentsClientError } = require('@interledger/open-payments');
const User = require('./User');
const Wallet = require('./Wallets');
const readline = require('readline/promises');
const { exec } = require('child_process');
const { db } = require('../db/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));


// ═══════════════════════════════════════════════════════════

class Transaction {
  
  static async get_incomingPayments(userId) {
    const client = await Wallet.create(userId);

    // Resolve user wallet/key getters (they're async) so we don't pass Promises
    const WALLET_ADDRESS_URL = await User.getWalletAddress(userId);

    const walletAddress = await client.walletAddress.get({ url: WALLET_ADDRESS_URL })

    const incomingGrant = await client.grant.request(
      { url: walletAddress.authServer },
      {
        access_token: {
          access: [{
            type: 'incoming-payment',
            actions: ['list', 'read', 'read-all']
          }]
        }
      }
    )

    if (!isFinalizedGrant(incomingGrant)) {
      throw new Error('Grant para incoming payments no finalizado')
    }

    const incomingPayments = await client.incomingPayment.list({
      url: walletAddress.resourceServer,
      accessToken: incomingGrant.access_token.value,
      walletAddress: walletAddress.id
    })

    let totalRecibido = 0

    if (!incomingPayments || !Array.isArray(incomingPayments.result) || incomingPayments.result.length === 0) {
      // Return an empty consistent shape when there are no incoming payments
      return { list: [], totalRecibido: 0 };
    } else {

      const list = incomingPayments.result.map((pago, index) => {
        totalRecibido += parseFloat(pago.receivedAmount.value)

        return {
          index: index + 1,
          status: pago.completed ? 'Completed' : 'Pending',
          amount: parseFloat(pago.receivedAmount.value) / Math.pow(10, pago.receivedAmount.assetScale),
          assetCode: pago.receivedAmount.assetCode,
          description: pago.metadata?.description,
          date: new Date(pago.createdAt).toLocaleString()
        }
      })

      // Persist fetched incoming payments for audit/fast reads
      try {
        if (incomingPayments && Array.isArray(incomingPayments.result) && incomingPayments.result.length) {
          await this._persistTransactions(userId, incomingPayments.result, 'incoming');
        }
      } catch (err) {
        console.error('Error persisting incoming payments:', err && err.message ? err.message : err);
      }

      return { list, totalRecibido };
    }
  }

  static async get_outgoingPayments(userId) {
    const client = await Wallet.create(userId);

    // Resolve user wallet/key getters (they're async) so we don't pass Promises
    const WALLET_ADDRESS_URL = await User.getWalletAddress(userId);

    const walletAddress = await client.walletAddress.get({ url: WALLET_ADDRESS_URL })

    const outgoingGrantRequest = await client.grant.request(
      { url: walletAddress.authServer },
      {
        access_token: {
          access: [{
            type: 'outgoing-payment',
            actions: ['list', 'list-all', 'read', 'read-all'],
            identifier: walletAddress.id
          }]
        },
        interact: {
          start: ['redirect']
        }
      }
    )

  
    if (!isPendingGrant(outgoingGrantRequest)) {
      throw new Error('Se esperaba un grant pendiente para outgoing payments')
    }
    // open the interact URL in the default browser (acts like a popup)
    const url = outgoingGrantRequest.interact.redirect;

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

    const finalizedOutgoingGrant = await client.grant.continue({
      url: outgoingGrantRequest.continue.uri,
      accessToken: outgoingGrantRequest.continue.access_token.value
    })

    if (!isFinalizedGrant(finalizedOutgoingGrant)) {
      throw new Error('There was an error continuing the grant. You probably have not accepted the grant at the url (or it has already been used up, in which case, rerun the script).')
    }

  
    
    const outgoingPayments = await client.outgoingPayment.list({
      url: walletAddress.resourceServer,
      accessToken: finalizedOutgoingGrant.access_token.value,
      walletAddress: walletAddress.id
    })

    let totalEnviado = 0

    if (!outgoingPayments || !Array.isArray(outgoingPayments.result) || outgoingPayments.result.length === 0) {
      // Return an empty consistent shape when there are no outgoing payments
      return { list: [], totalEnviado: 0 };
    } else {
      const list = outgoingPayments.result.map((pago, index) => {
        totalEnviado += parseFloat(pago.debitAmount.value)
        return {
          index: index + 1,
          status: pago.failed ? 'Failed' : 'Completed',
          amount: parseFloat(pago.debitAmount.value) / Math.pow(10, pago.debitAmount.assetScale),
          assetCode: pago.debitAmount.assetCode,
          description: pago.metadata?.description,
          date: new Date(pago.createdAt).toLocaleString()
        }
      })

      // Persist fetched outgoing payments for audit/fast reads
      try {
        if (outgoingPayments && Array.isArray(outgoingPayments.result) && outgoingPayments.result.length) {
          await this._persistTransactions(userId, outgoingPayments.result, 'outgoing');
        }
      } catch (err) {
        console.error('Error persisting outgoing payments:', err && err.message ? err.message : err);
      }

      return { list, totalEnviado };
    }
    }

  /**
   * Persist an array of transaction-like objects to Firestore under collection `transactions`.
   * Uses each item's `id` when available to upsert, otherwise generates a document id.
   */
  static async _persistTransactions(userId, items = [], direction = 'incoming') {
    if (!Array.isArray(items) || items.length === 0) return;
    const batch = db.batch();
    let batchSum = 0n; // atomic sum for this batch (incoming positive, outgoing positive)
    for (const item of items) {
      // Derive a safe document id:
      // - If provider gives an id and it contains no slashes, use it.
      // - If it contains unsafe chars (like '/'), hash it deterministically so
      //   the same provider id maps to the same doc without invalid path chars.
      // - Otherwise fall back to a random UUID.
      let txId;
      if (item.id && typeof item.id === 'string' && !item.id.includes('/')) {
        txId = item.id;
      } else if (item.id) {
        // Hash the id to make a safe doc id
        try {
          const h = crypto.createHash('sha256').update(String(item.id)).digest('hex');
          txId = `${direction}_${h}`;
        } catch (e) {
          txId = `${direction}_${crypto.randomUUID()}`;
        }
      } else {
        txId = `${direction}_${crypto.randomUUID()}`;
      }
      const ref = db.collection('transactions').doc(String(txId));

      // Extract common fields if present
      const status = item.status || item.state || null;
      const incomingAmount = item.incomingAmount || item.incoming_amount || null;
      const debitAmount = item.debitAmount || item.debit_amount || null;
      const amountObj = incomingAmount || debitAmount || item.amount || null;
      const amountValue = amountObj ? (amountObj.value ?? amountObj.amount ?? null) : null;
      const assetCode = amountObj ? (amountObj.assetCode || amountObj.currency || null) : null;
      const assetScale = amountObj ? (amountObj.assetScale ?? null) : null;

      const doc = {
        userId,
        direction,
        transactionId: item.id || null,
        status,
          // store atomic amount as string for precision
          amountAtomic: amountValue ? amountValue.toString() : null,
        assetCode,
        assetScale,
        raw: item,
        updatedAt: FieldValue.serverTimestamp(),
      };

      batch.set(ref, doc, { merge: true });
        // accumulate batch sum (treat incoming as positive, outgoing as positive here,
        // we'll apply sign on update)
        if (amountValue) {
          try {
            batchSum += BigInt(amountValue.toString());
          } catch (e) {
            // ignore parse errors for this item
          }
        }
    }
    await batch.commit();

      // After persisting transactions, update per-user cached balance document
      try {
        // Determine sign: incoming increases balance, outgoing decreases
        const delta = direction === 'incoming' ? batchSum : -batchSum;
        // Choose assetCode/assetScale from first item that has it
        let assetCode = null;
        let assetScale = null;
        for (const it of items) {
          const amt = it.incomingAmount || it.incoming_amount || it.debitAmount || it.debit_amount || it.amount || null;
          if (amt) {
            assetCode = assetCode || (amt.assetCode || amt.currency || null);
            assetScale = assetScale ?? (amt.assetScale ?? null);
          }
        }
        await this._updateBalance(userId, delta, assetCode, assetScale);
      } catch (err) {
        console.error('Error updating cached balance after persisting transactions:', err && err.message ? err.message : err);
      }
  }

    // Update per-user cached balance atomically. balanceAtomic saved as string.
    static async _updateBalance(userId, deltaAtomic, assetCode = null, assetScale = null) {
      const ref = db.collection('balances').doc(String(userId));
      try {
        console.debug(`[Transaction._updateBalance] user=${userId} delta=${String(deltaAtomic)} asset=${assetCode}/${assetScale}`);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
        let currentAtomic = 0n;
        let existingAssetCode = assetCode;
        let existingAssetScale = assetScale;
        if (snap.exists) {
          const data = snap.data();
          if (data && data.balanceAtomic) {
            try {
              currentAtomic = BigInt(data.balanceAtomic.toString());
            } catch (e) {
              currentAtomic = 0n;
            }
          }
          existingAssetCode = existingAssetCode || data.assetCode || null;
          existingAssetScale = existingAssetScale ?? (data.assetScale ?? null);
        }

        // Coerce deltaAtomic to BigInt safely (accept BigInt, number, or numeric string)
        let deltaBI;
        try {
          if (typeof deltaAtomic === 'bigint') deltaBI = deltaAtomic;
          else deltaBI = BigInt(String(deltaAtomic || '0'));
        } catch (e) {
          // If coercion fails, treat as zero
          deltaBI = 0n;
        }

        const newAtomic = currentAtomic + deltaBI;

        // Compute human-readable balance if assetScale is available
        let human = null;
        if (existingAssetScale != null) {
          try {
            const scale = BigInt(10) ** BigInt(existingAssetScale);
            const intPart = newAtomic / scale;
            const fracPart = (newAtomic < 0n ? -newAtomic : newAtomic) % scale;
            const fracStr = fracPart.toString().padStart(Number(existingAssetScale), '0');
            human = `${intPart.toString()}.${fracStr}`;
          } catch (err) {
            human = newAtomic.toString();
          }
        } else {
          human = newAtomic.toString();
        }

          tx.set(ref, {
            userId: String(userId),
            assetCode: existingAssetCode,
            assetScale: existingAssetScale,
            balanceAtomic: newAtomic.toString(),
            balanceHuman: human,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });

          console.debug(`[Transaction._updateBalance] user=${userId} old=${String(currentAtomic)} new=${String(newAtomic)} human=${human}`);
        });
      } catch (err) {
        console.error('[Transaction._updateBalance] transaction failed for', userId, err && err.message ? err.message : err);
        throw err;
      }
    }

    /**
     * Sync incoming and outgoing payments for a user with the provider and persist them
     * into Firestore. This will update the `transactions` and `balances` collections.
     * Designed to be safe to call at login time.
     */
    static async syncUser(userId) {
      const results = await Promise.allSettled([
        this.get_incomingPayments(userId).catch(err => { throw err }),
        this.get_outgoingPayments(userId).catch(err => { throw err })
      ]);

      const out = { incoming: null, outgoing: null, errors: [] };
      if (results[0].status === 'fulfilled') out.incoming = results[0].value;
      else out.errors.push({ kind: 'incoming', error: results[0].reason && results[0].reason.message ? results[0].reason.message : String(results[0].reason) });

      if (results[1].status === 'fulfilled') out.outgoing = results[1].value;
      else out.errors.push({ kind: 'outgoing', error: results[1].reason && results[1].reason.message ? results[1].reason.message : String(results[1].reason) });

      // Return quick snapshot of balances document if present
      try {
        const snap = await db.collection('balances').doc(String(userId)).get();
        out.balance = snap.exists ? snap.data() : null;
      } catch (err) {
        out.errors.push({ kind: 'balanceRead', error: err && err.message ? err.message : String(err) });
      }

      return out;
    }

    /**
     * Convert a human amount (e.g. "12.34") to atomic units (BigInt) using assetScale.
     * If amount is already an integer-like value (no dot) it's treated as atomic when assetScale is 0.
     */
    static humanToAtomic(amountHuman, assetScale = 0) {
      if (amountHuman === null || amountHuman === undefined) return 0n;
      const s = String(amountHuman).trim();
      if (s === '') return 0n;
      const negative = s.startsWith('-');
      const v = negative ? s.slice(1) : s;
      if (!v.includes('.')) {
        // No decimal point: treat as whole units; multiply by 10^assetScale
        try {
          const whole = BigInt(v);
          return negative ? -whole * (10n ** BigInt(assetScale)) : whole * (10n ** BigInt(assetScale));
        } catch (e) {
          // fallback parse via BigInt of scaled string
        }
      }
      const [intPart, fracPartRaw] = v.split('.');
      const fracPart = (fracPartRaw || '').padEnd(Number(assetScale), '0').slice(0, Number(assetScale));
      const atomicStr = `${intPart}${fracPart}` || '0';
      try {
        const atomic = BigInt(atomicStr);
        return negative ? -atomic : atomic;
      } catch (e) {
        // On parse error, return 0
        return 0n;
      }
    }

    /**
     * Record a local transfer between two users in Firestore and update balances.
     * amountHuman: decimal string or number in human units (e.g. 12.34)
     * assetScale: integer scale for the asset (e.g. 2 for cents)
     */
    static async recordLocalTransfer(fromUserId, toUserId, amountHuman, { assetCode = null, assetScale = 0, description = null, reference = null } = {}) {
      // Compute atomic amount
      const atomic = this.humanToAtomic(amountHuman, assetScale);
      if (atomic === 0n) throw new Error('Amount must be non-zero');

      const txId = `local_${crypto.randomUUID()}`;
      const outgoingRef = db.collection('transactions').doc(`${txId}_out`);
      const incomingRef = db.collection('transactions').doc(`${txId}_in`);

      const now = FieldValue.serverTimestamp();
      const outgoingDoc = {
        userId: fromUserId,
        direction: 'outgoing',
        transactionId: txId,
        status: 'Completed',
        amountAtomic: atomic.toString(),
        assetCode,
        assetScale,
        raw: { type: 'local_transfer', reference, description, toUserId },
        updatedAt: now,
      };

      const incomingDoc = {
        userId: toUserId,
        direction: 'incoming',
        transactionId: txId,
        status: 'Completed',
        amountAtomic: atomic.toString(),
        assetCode,
        assetScale,
        raw: { type: 'local_transfer', reference, description, fromUserId },
        updatedAt: now,
      };

      // Write both docs and then update balances atomically
      const batch = db.batch();
      batch.set(outgoingRef, outgoingDoc, { merge: true });
      batch.set(incomingRef, incomingDoc, { merge: true });
      await batch.commit();

      // Update balances: subtract from sender, add to receiver
      await this._updateBalance(fromUserId, -atomic, assetCode, assetScale);
      await this._updateBalance(toUserId, atomic, assetCode, assetScale);

      // Return created doc ids and new balance snapshot
      const snapFrom = await db.collection('balances').doc(String(fromUserId)).get();
      const snapTo = await db.collection('balances').doc(String(toUserId)).get();
      return {
        outgoingId: outgoingRef.id,
        incomingId: incomingRef.id,
        fromBalance: snapFrom.exists ? snapFrom.data() : null,
        toBalance: snapTo.exists ? snapTo.data() : null,
      };
    }
}

module.exports = Transaction;