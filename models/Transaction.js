// const Wallet = require('./Wallets');
// const User = require('./User');
// const { db } = require('../db/firebase');
// const { FieldValue } = require('firebase-admin/firestore');
// const crypto = require('crypto');


// /**
//  * Transaction helper that queries the Open Payments provider for a user's
//  * incoming and outgoing payments and exposes helpers to get balance info.
//  *
//  * Methods:
//  * - listOutgoing(userId, { cursor, limit })
//  * - listIncoming(userId, { cursor, limit })
//  * - listAll(userId, options)  // returns { incoming, outgoing }
//  * - getBalance(userId)       // attempts to read balance/asset info from walletAddress
//  */
// class Transactions {
// 	static async getClientAndAddress(userId) {
// 		const walletUrl = await User.getWalletAddress(userId);
// 		if (!walletUrl) throw new Error(`User ${userId} has no wallet_address_url set`);

// 		const client = await Wallet.create(userId);
// 		let walletAddress;
// 		try {
// 			walletAddress = await client.walletAddress.get({ url: walletUrl });
// 		} catch (err) {
// 			console.error('Error fetching walletAddress from provider for', { userId, walletUrl, err: err.message });
// 			throw new Error(`Failed to fetch walletAddress for user ${userId}: ${err.message}`);
// 		}

// 		// Validate provider response contains the endpoints we need
// 		if (!walletAddress || !walletAddress.authServer || !walletAddress.resourceServer) {
// 			console.error('Invalid walletAddress response', { userId, walletUrl, walletAddress });
// 			throw new Error(`Invalid walletAddress response for user ${userId}; missing authServer or resourceServer`);
// 		}

// 		return { client, walletAddress, walletUrl };
// 	}

// 	static async listOutgoing(userId, opts = {}) {
// 		// const { client, walletAddress } = await this.getClientAndAddress(userId);
// 		// const { cursor, limit } = opts;

// 		// // Request a grant with list-all permission for outgoing-payment
// 		// const outgoingPaymentListGrant = await client.grant.request(
// 		// 	{ url: walletAddress.authServer },
// 		// 	{
// 		// 		access_token: {
// 		// 			access: [
// 		// 				{
// 		// 					type: 'outgoing-payment',
// 		// 					actions: ['read', 'list-all']
// 		// 				}
// 		// 			]
// 		// 		}
// 		// 	}
// 		// );

// 		// const listParams = {
// 		// 	url: walletAddress.resourceServer,
// 		// 	accessToken: outgoingPaymentListGrant.access_token.value,
// 		// 	walletAddress: walletAddress.id
// 		// };
// 		// if (cursor) listParams.cursor = cursor;
// 		// if (limit) listParams.limit = limit;

// 		// const outgoingPayments = await client.outgoingPayment.list(listParams);

// 		// // Persist fetched outgoing payments for audit/queries
// 		// try {
// 		// 	if (outgoingPayments && outgoingPayments.data && outgoingPayments.data.length) {
// 		// 		await this._persistTransactions(userId, outgoingPayments.data, 'outgoing');
// 		// 	}
// 		// } catch (err) {
// 		// 	console.error('Error persisting outgoing payments:', err.message || err);
// 		// }
//     const outgoingPayments = 1
// 		return outgoingPayments;
// 	}

// 	// static async listIncoming(userId, opts = {}) {
// 	// 	const { client, walletAddress } = await this.getClientAndAddress(userId);
// 	// 	const { cursor, limit } = opts;

// 	// 	// Request a grant with list-all permission for incoming-payment if supported.
// 	// 	const incomingPaymentListGrant = await client.grant.request(
// 	// 		{ url: walletAddress.authServer },
// 	// 		{
// 	// 			access_token: {
// 	// 				access: [
// 	// 					{
// 	// 						type: 'incoming-payment',
// 	// 						actions: ['read', 'list-all']
// 	// 					}
// 	// 				]
// 	// 			}
// 	// 		}
// 	// 	);

// 	// 	const listParams = {
// 	// 		url: walletAddress.resourceServer,
// 	// 		accessToken: incomingPaymentListGrant.access_token.value,
// 	// 		walletAddress: walletAddress.id
// 	// 	};
// 	// 	if (cursor) listParams.cursor = cursor;
// 	// 	if (limit) listParams.limit = limit;

// 	// 	const incomingPayments = await client.incomingPayment.list(listParams);

// 	// 	// Persist fetched incoming payments for audit/queries
// 	// 	try {
// 	// 		if (incomingPayments && incomingPayments.data && incomingPayments.data.length) {
// 	// 			await this._persistTransactions(userId, incomingPayments.data, 'incoming');
// 	// 		}
// 	// 	} catch (err) {
// 	// 		console.error('Error persisting incoming payments:', err.message || err);
// 	// 	}

// 	// 	return incomingPayments;
// 	// }

// 	// static async listAll(userId, opts = {}) {
// 	// 	// Parallelize incoming/outgoing where possible
// 	// 	const [incoming, outgoing] = await Promise.all([
// 	// 		this.listIncoming(userId, opts).catch(err => {
// 	// 			console.error('Error listing incoming payments:', err.message || err);
// 	// 			return { data: [], pagination: null };
// 	// 		}),
// 	// 		this.listOutgoing(userId, opts).catch(err => {
// 	// 			console.error('Error listing outgoing payments:', err.message || err);
// 	// 			return { data: [], pagination: null };
// 	// 		})
// 	// 	]);

// 	// 	return { incoming, outgoing };
// 	// }

// 	// static async getBalance(userId) {
// 	// 	const { walletAddress } = await this.getClientAndAddress(userId);

// 	// 	// Many Open Payments providers include asset info on the wallet address.
// 	// 	// Some may include a balance field; if not available, return asset info
// 	// 	// and null balance so caller can decide how to compute/derive it.
// 	// 	const asset = {
// 	// 		assetCode: walletAddress.assetCode,
// 	// 		assetScale: walletAddress.assetScale
// 	// 	};

// 	// 	// Try common places for balance (may not be present depending on provider)
// 	// 	const balance = walletAddress.balance ?? walletAddress.availableBalance ?? null;

// 	// 	return { asset, balance, raw: walletAddress };
// 	// }

// 	// /**
// 	//  * Persist an array of transaction-like objects to Firestore under collection `transactions`.
// 	//  * Uses each item's `id` when available to upsert, otherwise generates a document.
// 	//  */
// 	// static async _persistTransactions(userId, items = [], direction = 'incoming') {
// 	// 	if (!Array.isArray(items) || items.length === 0) return;
// 	// 	const batch = db.batch();
// 	// 	for (const item of items) {
// 	// 		const txId = item.id || `${direction}_${item.reference || crypto?.randomUUID?.() || Date.now()}`;
// 	// 		const ref = db.collection('transactions').doc(txId.toString());

// 	// 		// Extract common fields if present
// 	// 		const status = item.status || item.state || null;
// 	// 		const incomingAmount = item.incomingAmount || item.incoming_amount || null;
// 	// 		const debitAmount = item.debitAmount || item.debit_amount || null;
// 	// 		const amountObj = incomingAmount || debitAmount || item.amount || null;
// 	// 		const amountValue = amountObj ? (amountObj.value ?? amountObj.amount ?? null) : null;
// 	// 		const assetCode = amountObj ? (amountObj.assetCode || amountObj.currency || null) : null;
// 	// 		const assetScale = amountObj ? (amountObj.assetScale || null) : null;

// 	// 		const doc = {
// 	// 			userId,
// 	// 			direction,
// 	// 			transactionId: item.id || null,
// 	// 			status,
// 	// 			amountRaw: amountValue ? amountValue.toString() : null,
// 	// 			assetCode,
// 	// 			assetScale,
// 	// 			raw: item,
// 	// 			updatedAt: FieldValue.serverTimestamp(),
// 	// 		};

// 	// 		batch.set(ref, doc, { merge: true });
// 	// 	}
// 	// 	await batch.commit();
// 	// }

// 	// /**
// 	//  * Compute balance from persisted transactions when provider doesn't expose balance.
// 	//  * Returns { asset: {assetCode, assetScale}, balance: { atomic: BigInt, human: string } }
// 	//  */
// 	// static async getComputedBalance(userId) {
// 	// 	// Attempt to use provider-exposed balance first
// 	// 	const prov = await this.getBalance(userId);
// 	// 	if (prov && prov.balance !== null && prov.balance !== undefined) {
// 	// 		return { source: 'provider', asset: prov.asset, balance: prov.balance };
// 	// 	}

// 	// 	// Otherwise aggregate persisted transactions
// 	// 	const snap = await db.collection('transactions').where('userId', '==', userId).get();
// 	// 	if (snap.empty) return { source: 'computed', asset: null, balance: null };

// 	// 	let assetCode = null;
// 	// 	let assetScale = null;
// 	// 	let incomingSum = 0n;
// 	// 	let outgoingSum = 0n;

// 	// 	for (const d of snap.docs) {
// 	// 		const t = d.data();
// 	// 		if (!assetCode && t.assetCode) assetCode = t.assetCode;
// 	// 		if (!assetScale && t.assetScale !== undefined && t.assetScale !== null) assetScale = t.assetScale;
// 	// 		const v = t.amountRaw ? BigInt(t.amountRaw.toString()) : null;
// 	// 		if (v !== null) {
// 	// 			if (t.direction === 'incoming') incomingSum += v;
// 	// 			else outgoingSum += v;
// 	// 		}
// 	// 	}

// 	// 	const atomic = incomingSum - outgoingSum;
// 	// 	let human = null;
// 	// 	try {
// 	// 		if (assetScale != null) {
// 	// 			const scale = BigInt(10) ** BigInt(assetScale);
// 	// 			// Convert to decimal string with scale
// 	// 			const intPart = atomic / scale;
// 	// 			const fracPart = (atomic < 0n ? -atomic : atomic) % scale;
// 	// 			const fracStr = fracPart.toString().padStart(Number(assetScale), '0');
// 	// 			human = `${intPart.toString()}.${fracStr}`;
// 	// 		}
// 	// 	} catch (err) {
// 	// 		human = atomic.toString();
// 	// 	}

// 	// 	return { source: 'computed', asset: { assetCode, assetScale }, balance: { atomic, human } };
// 	// }
    
// 	// Fast Firestore-only aggregation for dashboard use. Does not call provider.
// 	// Returns { asset: {assetCode, assetScale}, balanceHuman: string|null, balanceAtomic: BigInt|null }
// 	static async getCachedBalance(userId) {
// 		const snap = await db.collection('transactions').where('userId', '==', userId).get();
// 		if (snap.empty) return { asset: null, balanceHuman: null, balanceAtomic: null };

// 		let assetCode = null;
// 		let assetScale = null;
// 		let incomingSum = 0n;
// 		let outgoingSum = 0n;

// 		for (const d of snap.docs) {
// 			const t = d.data();
// 			if (!assetCode && t.assetCode) assetCode = t.assetCode;
// 			if (!assetScale && t.assetScale !== undefined && t.assetScale !== null) assetScale = t.assetScale;
// 			const v = t.amountRaw ? BigInt(t.amountRaw.toString()) : null;
// 			if (v !== null) {
// 				if (t.direction === 'incoming') incomingSum += v;
// 				else outgoingSum += v;
// 			}
// 		}

// 		const atomic = incomingSum - outgoingSum;
// 		let human = null;
// 		if (assetScale != null) {
// 			try {
// 				const scale = BigInt(10) ** BigInt(assetScale);
// 				const intPart = atomic / scale;
// 				const fracPart = (atomic < 0n ? -atomic : atomic) % scale;
// 				const fracStr = fracPart.toString().padStart(Number(assetScale), '0');
// 				human = `${intPart.toString()}.${fracStr}`;
// 			} catch (err) {
// 				human = atomic.toString();
// 			}
// 		} else {
// 			human = atomic.toString();
// 		}

// 		return { asset: { assetCode, assetScale }, balanceHuman: human, balanceAtomic: atomic };
// 	}

// }

// module.exports = Transactions;
