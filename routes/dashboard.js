const express = require('express');
const router = express.Router();
const User = require('../models/User');
// const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallets');
const { db } = require('../db/firebase');


// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/auth/login');
}

// Dashboard
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');

    // Avoid heavy provider operations on page render. Use cached Firestore aggregation.
    const walletAddressUrl = await User.getWalletAddress(user.id);
    let wallet = { id: walletAddressUrl || null, wallet_address_url: walletAddressUrl || null, balance: 0 };
    try {
      const bal = await Transaction.getCachedBalance(user.id);
      if (bal && bal.balanceHuman) wallet.balance = parseFloat(bal.balanceHuman);
    } catch (err) {
      console.warn('Could not compute cached balance for dashboard:', err.message || err);
    }

    // Load persisted transactions for this user from Firestore for display.
    let transactions = [];
    try {
      const snap = await db.collection('transactions')
        .where('userId', '==', user.id)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get();
      transactions = snap.docs.map(d => {
        const t = d.data();
        // Normalize fields expected by the view
        const createdAt = t.updatedAt && t.updatedAt.toDate ? t.updatedAt.toDate() : (t.updatedAt || new Date());
        const amount = t.amountRaw ? Number(t.amountRaw.toString()) : 0;
        return {
          id: d.id,
          from_wallet_id: t.raw && t.raw.fromWallet ? t.raw.fromWallet : (t.from_wallet_id || null),
          to_user_id: t.raw && t.raw.toUserId ? t.raw.toUserId : (t.to_user_id || null),
          from_user_id: t.raw && t.raw.fromUserId ? t.raw.fromUserId : (t.from_user_id || null),
          amount: amount,
          description: t.raw && t.raw.description ? t.raw.description : (t.description || ''),
          created_at: createdAt
        };
      });
    } catch (err) {
      console.error('Error loading persisted transactions for dashboard:', err);
      transactions = [];
    }

    if (user.account_type === 'father') {
      const children = await User.getChildren(user.id);
      const childrenWithWallets = await Promise.all(children.map(async child => {
        const childWalletAddress = await User.getWalletAddress(child.id);
        const childWallet = { id: childWalletAddress || null, wallet_address_url: childWalletAddress || null, balance: 0 };
        try {
          const cb = await Transaction.getCachedBalance(child.id);
          if (cb && cb.balanceHuman) childWallet.balance = parseFloat(cb.balanceHuman);
        } catch (err) {
          console.warn('Could not compute cached balance for child', child.id, err.message || err);
        }
        return { ...child, wallet: childWallet };
      }));

      res.render('dashboard-father', {
        user,
        wallet,
        children: childrenWithWallets,
        transactions
      });
    } else {
      const parent = user.parent_id ? await User.findById(user.parent_id) : null;
      res.render('dashboard-child', {
        user,
        wallet,
        parent,
        transactions
      });
    }
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
});

// Transfer money (for father accounts)
router.post('/transfer', isAuthenticated, async (req, res) => {
  // try {
    const user = await User.findById(req.session.userId);

    if (user.account_type !== 'father') {
      return res.status(403).json({ error: 'Only father accounts can transfer money' });
    }

    const { from_user_id, to_user_id, amount, description } = req.body;
    const transferAmount = parseFloat(amount);

    if (transferAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    const fromUser = await User.findById(from_user_id);
    const toUser = await User.findById(to_user_id);
    

    if (!fromUser || !toUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const toWallet = await User.getWalletAddress(to_user_id);

    const fromWallet = await User.getWalletAddress(from_user_id);

    await Wallet.pay(from_user_id, toWallet, transferAmount);

    const canAccessFrom = fromUser.id === user.id || fromUser.parent_id === user.id;
    const canAccessTo = toUser.id === user.id || toUser.parent_id === user.id;

    if (!canAccessFrom || !canAccessTo) {
      return res.status(403).json({ error: 'You do not have permission to perform this transfer' });
    }

  //   // Create ILP transaction (returns interactive grant URL if needed)
  //   const result = await Transaction.create(fromUser.id, toUser.id, transferAmount, description);

  //   if (result.requiresInteraction) {
  //     return res.json({ 
  //       success: false,
  //       requiresInteraction: true,
  //       interactUrl: result.interactUrl,
  //       transactionId: result.transactionId,
  //       message: result.message
  //     });
  //   }

  //   res.json({ success: true, message: 'Transfer completed successfully' });
  // } catch (error) {
  //   console.error('Transfer error:', error);
  //   res.status(500).json({ error: error.message });
  // }

});

// // Return transactions (incoming + outgoing) and computed balance for the authenticated user
// router.get('/transactions', isAuthenticated, async (req, res) => {
//   // try {
//   //   const userId = req.query.userId || req.session.userId;
//   //   if (!userId) return res.status(400).json({ error: 'userId required' });

//   //   const cursor = req.query.cursor;
//   //   const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

//   //   const data = await Transaction.listAll(userId, { cursor, limit });
//   //   const balance = await Transaction.getComputedBalance(userId);

//   //   res.json({ incoming: data.incoming, outgoing: data.outgoing, balance });
//   // } catch (err) {
//   //   console.error('Transactions endpoint error:', err);
//   //   res.status(500).json({ error: err.message });
//   // }
// });

// // Debug route: fetch provider lists and persisted transactions for a given userId
// router.get('/debug/transactions/:userId', isAuthenticated, async (req, res) => {
//   // try {
//   //   const userId = req.params.userId;
//   //   if (!userId) return res.status(400).json({ error: 'userId required' });

//   //   const provider = await Transaction.listAll(userId, { limit: req.query.limit ? parseInt(req.query.limit, 10) : 50 });
//   //   const persistedSnap = await db.collection('transactions').where('userId', '==', userId).limit(200).get();
//   //   const persisted = persistedSnap.docs.map(d => ({ id: d.id, ...d.data() }));

//   //   res.json({ provider, persistedCount: persisted.length, persisted });
//   // } catch (err) {
//   //   console.error('Debug transactions error:', err);
//   //   res.status(500).json({ error: err.message });
//   // }
// });




module.exports = router;

