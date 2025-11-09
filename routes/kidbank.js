const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wallet = require('../models/Wallets');

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/auth/login');
}

// KidBank main interface
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');
    
    const wallet = {
      id: user.id,
      wallet_address_url: user.wallet_address_url || null,
      balance: 0,
      ilpAvailable: !!(user.ilp_key_id && user.ilp_private_key_path)
    };

    const mockTransactions = [
      {
        id: "tx-1",
        type: "deposit",
        amount: 20.00,
        description: "Weekly allowance",
        created_at: new Date().toISOString()
      },
      {
        id: "tx-2",
        type: "reward",
        amount: 5.00,
        description: "Completed homework",
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];
    
    const dashboardData = {
      userName: user.full_name || user.name || 'User',
      wallet,
      userStars: 245,
      userBalance: wallet.balance.toFixed(2),
      monthGain: 23.50,
      transactions: mockTransactions,
      savingsGoals: [
        {
          name: "New Video Game",
          icon: "🎮",
          color: "linear-gradient(135deg, #3b82f6, #06b6d4)",
          saved: 45,
          target: 60
        }
      ],
      tasks: [
        {
          id: "task-1",
          name: "Clean my room",
          icon: "🏠",
          color: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          reward: 5,
          stars: 10,
          completed: false
        }
      ],
      investmentBalance: 85.75,
      investmentEarnings: 5.75,
      gameLevel: 12,
      totalCoins: 1250,
      achievementsUnlocked: 8,
      dayStreak: 5
    };

    res.render('kidbank-dashboard', dashboardData);
  } catch (error) {
    console.error('KidBank error:', error);
    res.status(500).send('Error loading KidBank: ' + error.message);
  }
});

// Handle KidBank transfers
router.post('/transfer', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.account_type !== 'child') {
      return res.status(403).json({ error: 'Only child accounts can use KidBank transfers' });
    }

    const { to_address, amount } = req.body;
    const transferAmount = parseFloat(amount);

    if (transferAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Use Wallet.pay for the transfer
    try {
      await Wallet.pay(user.id, to_address, transferAmount);
      res.json({ success: true, message: 'Transfer completed successfully' });
    } catch (walletError) {
      if (walletError.interactUrl) {
        return res.json({ 
          success: false,
          requiresInteraction: true,
          interactUrl: walletError.interactUrl,
          message: 'Authorization required to complete transfer'
        });
      }
      throw walletError;
    }

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;