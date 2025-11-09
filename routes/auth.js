const express = require('express');
const router = express.Router();
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let Wallet;
try { Wallet = require('../models/Wallets'); } catch (e) { console.warn('Wallet model unavailable', e.message); }

const { sendVerificationEmail, generateEmailVerificationToken } = require('../services/sendVerificationEmail');


router.get('/register', (req, res) => {
  res.render('register');
});

// Handle registration
// Multer setup for single private key upload in memory
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 } });

router.post('/register', upload.single('ilp_private_key'), async (req, res) => {
  try {
    const { email, password, account_type, parent_email, full_name, date_of_birth, address, phone, ilp_key_id, walletAddressUrl } = req.body;

    // Validate required fields
    if (!email || !password || !account_type || !full_name || !date_of_birth || !address || !phone || !ilp_key_id || !walletAddressUrl) {
      return res.status(400).render('register', { error: 'All fields are required for KYC verification' });
    }

    // If child account, verify parent exists
    let parent_id = null;
    if (account_type === 'child') {
      if (!parent_email) {
        return res.status(400).render('register', { error: 'Parent email is required for child accounts' });
      }
      const parent = await User.findByEmail(parent_email);
      if (!parent) {
        return res.status(400).render('register', { error: 'Parent account not found' });
      }
      if (parent.account_type !== 'father') {
        return res.status(400).render('register', { error: 'Parent must be a father account' });
      }
      parent_id = parent.id;
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).render('register', { error: 'Email already registered' });
    }

    // Create user
    const userId = await User.create({
      email,
      password,
      account_type,
      parent_id,
      full_name,
      date_of_birth,
      address,
      phone
    });

    // Generate email verification token & save
    const { token, expires } = generateEmailVerificationToken();
    await User.setEmailVerification(userId, token, expires);

    // Fire off email (non-blocking but awaited here for simplicity)
    await sendVerificationEmail({ id: userId, email }, token);

    // Determine wallet address source: explicit form field, env override, or auto-base
    let resolvedWalletAddressUrl = null;
    if (walletAddressUrl && walletAddressUrl.trim()) {
      resolvedWalletAddressUrl = walletAddressUrl.trim();
    } else if (process.env.CLIENT_WALLET_ADDRESS_URL) {
      resolvedWalletAddressUrl = process.env.CLIENT_WALLET_ADDRESS_URL.trim();
    } else if (process.env.ILP_BASE_WALLET_URL) {
      // Fallback auto generation using base + userId (demo purpose)
      resolvedWalletAddressUrl = `${process.env.ILP_BASE_WALLET_URL.replace(/\/$/, '')}/${userId}`;
    }

    if (Wallet && Wallet.create && resolvedWalletAddressUrl) {
      try {
        await Wallet.create(userId, resolvedWalletAddressUrl);
        await User.setWalletAddress(userId, resolvedWalletAddressUrl);
      } catch (walletErr) {
        console.warn('Wallet creation warning:', walletErr.message);
      }
    } else if (!resolvedWalletAddressUrl) {
      console.warn('No wallet address URL provided or derivable; user will need to set it later.');
    }

    // Handle ILP key ID and private key file
    if (ilp_key_id || req.file) {
      const updates = {};
      if (ilp_key_id) updates.ilp_key_id = ilp_key_id.trim();
      if (req.file) {
        // Persist private key securely under /secrets/ directory (ensure gitignore)
        const secretsDir = path.join(__dirname, '..', 'secrets');
        if (!fs.existsSync(secretsDir)) fs.mkdirSync(secretsDir);
        const keyFilename = `private_${userId}.key`;
        const keyPath = path.join(secretsDir, keyFilename);
        fs.writeFileSync(keyPath, req.file.buffer.toString('utf8'), { encoding: 'utf8', flag: 'w' });
        updates.ilp_private_key_path = keyPath;
      }
      if (Object.keys(updates).length) {
        await User.collection().doc(userId).update(updates);
      }
    }

    res.redirect('/auth/login?registered=true&verifyPending=true');
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).render('register', { error: 'Registration failed: ' + error.message });
  }
});

// Login page
router.get('/login', (req, res) => {
  const registered = req.query.registered === 'true';
  res.render('login', { registered });
});

// Handle login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }

    if (!User.verifyPassword(password, user.password)) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }

    if (!user.email_verified) {
      return res.status(403).render('login', { error: 'Email not verified. Please check your inbox.' });
    }

    req.session.userId = user.id;
    req.session.accountType = user.account_type;

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).render('login', { error: 'Login failed' });
  }
});

// Email verification endpoint
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');
  try {
    const result = await User.verifyEmailByToken(token);
    if (!result.success) {
      if (result.reason === 'expired') return res.status(400).send('Verification link expired. Please register again.');
      return res.status(400).send('Invalid verification token.');
    }
    res.send('Email verified! You can now log in.');
  } catch (err) {
    console.error('Verify email error:', err.message);
    res.status(500).send('Verification failed');
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
});

module.exports = router;