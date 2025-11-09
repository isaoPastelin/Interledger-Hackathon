const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wallet = require('../models/Wallets');
const ILP = require('../services/interledgerClient');

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
    // Build a lightweight wallet object from the user record for rendering.
    // Do NOT attempt to create an authenticated ILP client here — that would try
    // to load the private key and cause the OpenPaymentsClientError when the
    // user doesn't have ILP credentials configured. Transfers still use
    // Wallet.pay() which will create a client when needed.
    const wallet = {
      id: user.id,
      wallet_address_url: user.wallet_address_url || null,
      balance: 0,
      ilpAvailable: !!(user.ilp_key_id && user.ilp_private_key_path)
    };

    // Use empty transactions array for rendering (we'll keep mock/real separation elsewhere)
    const transactions = [];

    if (user.account_type === 'father') {
      const children = await User.getChildren(user.id);
      // Do not instantiate ILP clients for child wallets while rendering.
      const childrenWithWallets = children.map(child => {
        return {
          ...child,
          wallet: {
            id: child.id,
            wallet_address_url: child.wallet_address_url || null,
            balance: child.wallet?.balance || 0,
            ilpAvailable: !!(child.ilp_key_id && child.ilp_private_key_path)
          }
        };
      });

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

    const { from_user_id, to_user_id, amount } = req.body;
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

    const toWalletAddress = await User.getWalletAddress(to_user_id);
    console.log(`Transferring ${transferAmount} from ${from_user_id} to ${toWalletAddress}`);

    // Use Wallet.pay for the transfer
    try {
      await Wallet.pay(from_user_id, toWalletAddress, transferAmount);
      res.json({ success: true, message: 'Transfer completed successfully' });
    } catch (walletError) {
      // Check if this is an interactive grant request
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
    console.error('KidBank transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RUTA 2: KIDBANK - NUEVA
router.get('/kidbank', isAuthenticated, async (req, res) => {
  try {
    console.log('✅ KidBank route hit!'); // DEBUG
    
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');

    // Only allow children to access KidBank
    if (user.account_type !== 'child') {
      return res.redirect('/dashboard');
    }

    // Build lightweight wallet object for KidBank render (don't load ILP client here)
    const wallet = {
      id: user.id,
      wallet_address_url: user.wallet_address_url || null,
      balance: 0,
      ilpAvailable: !!(user.ilp_key_id && user.ilp_private_key_path)
    };

    // Use mock transactions instead of database queries
    const mockTransactions = [
      {
        id: 'mock-tx-1',
        description: 'Weekly Allowance',
        amount: 20.00,
        from_wallet_id: null,
        to_wallet_id: wallet.id,
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // yesterday
      },
      {
        id: 'mock-tx-2',
        description: 'Savings Transfer',
        amount: 5.00,
        from_wallet_id: wallet.id,
        to_wallet_id: 'savings',
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
      }
    ];
    
    // Prepare dashboard data with all mock data
    const mockData = {
      userName: user.full_name || user.name || 'User',
      wallet, // Need this for transaction comparison
      userStars: 245,
      userBalance: wallet.balance.toFixed(2),
      monthGain: 23.50,
      transactions: mockTransactions, // Mock transactions
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

    // Render the dashboard with the mock data
    res.render('kidbank-dashboard', mockData);
  } catch (error) {
    console.error('KidBank error:', error);
    res.status(500).send('Error loading KidBank: ' + error.message);
  }
});

module.exports = router;

