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

// ========================================
// 🌟 NUEVA RUTA: KidBank UI
// ========================================
router.get('/kidbank', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).send('User not found');

    // Get wallet and balance
    let wallet = await Wallet.findByUserId(user.id);
    if (!wallet) {
      wallet = { id: null, wallet_address_url: null, balance: 0 };
    } else {
      const bal = await Wallet.getBalance(wallet.id);
      wallet.balance = typeof bal === 'number' ? bal : 0;
    }

    // Get transactions
    const allTransactions = wallet.id ? await Transaction.getByWalletId(wallet.id) : [];
    
    // Calculate month gain (transactions from current month)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTransactions = allTransactions.filter(t => {
      const txDate = new Date(t.created_at);
      return txDate >= startOfMonth;
    });
    
    const monthGain = monthTransactions.reduce((sum, tx) => {
      // Assuming positive amounts are received, negative are sent
      return sum + (tx.amount > 0 ? tx.amount : 0);
    }, 0);

    // Format transactions for KidBank UI
    const formattedTransactions = allTransactions.slice(0, 10).map(tx => ({
      name: tx.description || 'Transaction',
      amount: Math.abs(tx.amount),
      type: tx.amount > 0 ? 'received' : 'sent',
      date: formatDate(tx.created_at),
      icon: tx.amount > 0 ? '🪙' : '💸',
      iconBg: tx.amount > 0 ? '#22c55e' : '#f97316'
    }));

    // Placeholder data for features not yet in your DB
    // TODO: Create these models/tables in your database
    const savingsGoals = [
      // You can add logic here to fetch from a SavingsGoals table
      // For now, using placeholder data
    ];

    const tasks = [
      // You can add logic here to fetch from a Tasks table
      // For now, using placeholder data
    ];

    // Render KidBank dashboard
    res.render('kidbank-dashboard', {
      // User info
      userName: user.name,
      userStars: user.stars || 245, // Add 'stars' column to User table if needed
      
      // Balance info
      userBalance: wallet.balance.toFixed(2),
      monthGain: monthGain.toFixed(2),
      
      // Transactions
      transactions: formattedTransactions,
      
      // Investment info (placeholder - add to your DB)
      investmentBalance: (wallet.balance * 0.1).toFixed(2), // Example: 10% invested
      investmentEarnings: (wallet.balance * 0.05).toFixed(2), // Example: 5% earnings
      
      // Game stats (placeholder - add to your DB)
      gameLevel: user.level || 1, // Add 'level' column to User table if needed
      totalCoins: user.coins || 0, // Add 'coins' column to User table if needed
      achievementsUnlocked: user.achievements || 0, // Add 'achievements' column to User table if needed
      dayStreak: user.streak || 0, // Add 'streak' column to User table if needed
      
      // Features to implement later
      savingsGoals: savingsGoals,
      tasks: tasks
    });
  } catch (error) {
    console.error('KidBank dashboard error:', error);
    res.status(500).send('Error loading KidBank dashboard');
  }
});

// Helper function to format dates
function formatDate(date) {
  const now = new Date();
  const txDate = new Date(date);
  const diffTime = Math.abs(now - txDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ========================================
// 🎯 API ENDPOINTS para KidBank
// ========================================

// Complete a task
router.post('/api/complete-task', isAuthenticated, async (req, res) => {
  try {
    const { taskId } = req.body;
    const user = await User.findById(req.session.userId);
    
    // TODO: Implement task completion logic
    // 1. Mark task as completed in database
    // 2. Add reward to user's wallet
    // 3. Add stars to user
    
    // Placeholder response
    res.json({
      success: true,
      message: 'Task completed!',
      earnedMoney: 5,
      earnedStars: 10
    });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add money to account
router.post('/api/add-money', isAuthenticated, async (req, res) => {
  try {
    const { amount } = req.body;
    const transferAmount = parseFloat(amount);
    
    if (transferAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }
    
    const user = await User.findById(req.session.userId);
    
    // TODO: Implement add money logic
    // This might involve creating a transaction from parent to child
    // or recording an external deposit
    
    res.json({
      success: true,
      message: `Added $${transferAmount} successfully!`,
      newBalance: 0 // TODO: return actual new balance
    });
  } catch (error) {
    console.error('Add money error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// RUTAS ORIGINALES (sin cambios)
// ========================================

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
