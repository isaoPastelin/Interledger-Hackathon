const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

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
    // Ensure we always pass a wallet object with a numeric balance to the views
    let wallet = await Wallet.findByUserId(user.id);
    if (!wallet) {
      wallet = { id: null, wallet_address_url: null, balance: 0 };
    } else {
      const bal = await Wallet.getBalance(wallet.id);
      wallet.balance = typeof bal === 'number' ? bal : 0;
    }

    const transactions = wallet.id ? await Transaction.getByWalletId(wallet.id) : [];

    if (user.account_type === 'father') {
      const children = await User.getChildren(user.id);
      const childrenWithWallets = await Promise.all(children.map(async child => {
        let childWallet = await Wallet.findByUserId(child.id);
        if (!childWallet) {
          childWallet = { id: null, wallet_address_url: null, balance: 0 };
        } else {
          const cb = await Wallet.getBalance(childWallet.id);
          childWallet.balance = typeof cb === 'number' ? cb : 0;
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
  try {
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

    const canAccessFrom = fromUser.id === user.id || fromUser.parent_id === user.id;
    const canAccessTo = toUser.id === user.id || toUser.parent_id === user.id;

    if (!canAccessFrom || !canAccessTo) {
      return res.status(403).json({ error: 'You do not have permission to perform this transfer' });
    }

    // Create ILP transaction (returns interactive grant URL if needed)
    const result = await Transaction.create(fromUser.id, toUser.id, transferAmount, description);

    if (result.requiresInteraction) {
      return res.json({ 
        success: false,
        requiresInteraction: true,
        interactUrl: result.interactUrl,
        transactionId: result.transactionId,
        message: result.message
      });
    }

    res.json({ success: true, message: 'Transfer completed successfully' });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Complete pending transaction after grant approval
router.post('/complete-transfer/:transactionId', isAuthenticated, async (req, res) => {
  try {
    const { transactionId } = req.params;
    await Transaction.completePendingTransaction(transactionId);
    res.json({ success: true, message: 'Transfer completed successfully' });
  } catch (error) {
    console.error('Complete transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
