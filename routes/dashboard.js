const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');

function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/auth/login');
}

// RUTA 1: Dashboard original
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');
    
    let wallet = await Wallet.findByUserId(user.id);
    if (!wallet) {
      wallet = { id: null, wallet_address_url: null, balance: 0 };
    } else {
      const bal = await Wallet.getBalance(wallet.id);
      wallet.balance = typeof bal === 'number' ? bal : 0;
    }

    // Get all transactions for this wallet
    const transactions = wallet.id ? await Transaction.getByWalletId(wallet.id) : [];
    
    // Format transactions for display
    const formattedTransactions = transactions.map(t => ({
      name: t.description || 'Transaction',
      date: new Date(t.timestamp).toLocaleDateString(),
      amount: t.amount.toFixed(2),
      type: t.to_user_id === user.id ? 'received' : 'sent',
      icon: t.to_user_id === user.id ? '🪙' : '💸',
      iconBg: t.to_user_id === user.id ? '#22c55e' : '#ea580c'
    }));

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

    let wallet = await Wallet.findByUserId(user.id);
    if (!wallet) {
      wallet = { id: null, wallet_address_url: null, balance: 0 };
    } else {
      const bal = await Wallet.getBalance(wallet.id);
      wallet.balance = typeof bal === 'number' ? bal : 0;
    }

    const allTransactions = wallet.id ? await Transaction.getByWalletId(wallet.id) : [];
    
    // Prepare example data for the dashboard
    const mockData = {
      userName: user.full_name || user.name || 'User',
      userStars: 245,
      userBalance: wallet.balance || 0,
      monthGain: 23.50,
      transactions: [
        {
          name: "Weekly Allowance",
          date: "Today",
          amount: "10.00",
          type: "received",
          icon: "🪙",
          iconBg: "#22c55e"
        }
      ],
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

// RUTA 3: Transfer (original)
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

// RUTA 4: Complete transfer (original)
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

// API Endpoints for KidBank
router.post('/api/complete-task', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const { taskId } = req.body;
    const taskReward = 5; // This would come from your task database
    const taskStars = 10;

    // Get user's wallet
    let wallet = await Wallet.findByUserId(user.id);
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Create a transaction for the task reward
    const description = `Task Reward: Task #${taskId}`;
    await Transaction.create(null, user.id, taskReward, description);

    res.json({
      success: true,
      earnedMoney: taskReward,
      earnedStars: taskStars,
      message: 'Task completed successfully!'
    });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add money endpoint (requires parent approval)
router.post('/api/add-money', isAuthenticated, async (req, res) => {
  try {
    console.log('Add money request from user:', req.session.userId);
    
    if (!req.session.userId) {
      console.error('No userId in session');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(req.session.userId);
    console.log('Found user:', user ? 'yes' : 'no');
    
    if (!user) {
      console.error('User not found with id:', req.session.userId);
      return res.status(404).json({ error: 'User not found' });
    
    const { amount, description } = req.body;
    const transferAmount = parseFloat(amount);

    if (transferAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // If it's a child, require parent approval
    if (user.account_type === 'child' && user.parent_id) {
      // Create a pending transaction that requires parent approval
      const result = await Transaction.create(null, user.id, transferAmount, description || 'Added money to wallet');
      
      if (result.requiresInteraction) {
        return res.json({
          success: false,
          requiresInteraction: true,
          interactUrl: result.interactUrl,
          transactionId: result.transactionId,
          message: 'Waiting for parent approval'
        });
      }
    }

    res.json({
      success: true,
      message: `Added $${transferAmount} to your wallet!`
    });
  } catch (error) {
    console.error('Add money error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send money endpoint
router.post('/api/send-money', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { to_user_id, amount, description } = req.body;
    const transferAmount = parseFloat(amount);

    if (transferAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Check if sender has enough balance
    const senderWallet = await Wallet.findByUserId(user.id);
    if (!senderWallet) {
      return res.status(404).json({ error: 'Sender wallet not found' });
    }

    const balance = await Wallet.getBalance(senderWallet.id);
    if (balance < transferAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // If child is sending money, require parent approval
    if (user.account_type === 'child' && user.parent_id) {
      const result = await Transaction.create(user.id, to_user_id, transferAmount, description || 'Sent money');
      
      if (result.requiresInteraction) {
        return res.json({
          success: false,
          requiresInteraction: true,
          interactUrl: result.interactUrl,
          transactionId: result.transactionId,
          message: 'Waiting for parent approval'
        });
      }
    } else {
      await Transaction.create(user.id, to_user_id, transferAmount, description || 'Sent money');
    }

    res.json({
      success: true,
      message: `Sent $${transferAmount} successfully!`
    });
  } catch (error) {
    console.error('Send money error:', error);
    res.status(500).json({ error: error.message });
  }
});

// IMPORTANTE: Esto debe ser lo último
module.exports = router;