const { db } = require('../db/firebase');
const bcrypt = require('bcryptjs');
const { FieldValue } = require('firebase-admin/firestore');

class User {
  static collection() {
    return db.collection('users');
  }

  static async create(userData) {
    const hashedPassword = bcrypt.hashSync(userData.password, 10);
    const doc = {
      email: userData.email,
      password: hashedPassword,
      account_type: userData.account_type,
      parent_id: userData.parent_id || null,
      full_name: userData.full_name,
      date_of_birth: userData.date_of_birth,
      address: userData.address,
      phone: userData.phone,
      kyc_verified: 0,
      email_verified: false,
      email_verification_token: null,
      email_verification_expires: null,
      // Interledger wallet address (to be set after wallet creation)
      wallet_address_url: null,
      // Optional per-user ILP credentials
      ilp_key_id: null,
      ilp_private_key_path: null,
      created_at: FieldValue.serverTimestamp(),
    };

    const ref = await this.collection().add(doc);
    return ref.id;
  }

  static async setWalletAddress(userId, walletAddressUrl) {
    await this.collection().doc(userId).update({
      wallet_address_url: walletAddressUrl
    });
  }

  static async setEmailVerification(userId, token, expires) {
    await this.collection().doc(userId).update({
      email_verification_token: token,
      email_verification_expires: expires,
    });
  }

  static async setIlpCredentials(userId, keyId, privateKeyPath) {
    // Ensure secrets directory exists
    const secretsDir = path.join(__dirname, '..', 'secrets');
    if (!fs.existsSync(secretsDir)) {
      fs.mkdirSync(secretsDir);
    }

    // Generate a key file name based on userId if not provided
    if (!privateKeyPath) {
      const keyFileName = `private_${userId}.key`;
      privateKeyPath = path.join(secretsDir, keyFileName);
    }

    const updates = {
      ilp_key_id: keyId,
      ilp_private_key_path: privateKeyPath
    };

    await this.collection().doc(userId).update(updates);
    return updates;
  }

  static async verifyEmailByToken(token) {
    const snap = await this.collection().where('email_verification_token', '==', token).limit(1).get();
    if (snap.empty) return { success: false, reason: 'invalid' };
    const doc = snap.docs[0];
    const data = doc.data();
    if (!data.email_verification_expires || data.email_verification_expires.toDate() < new Date()) {
      return { success: false, reason: 'expired' };
    }
    await doc.ref.update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires: null,
    });
    return { success: true, userId: doc.id };
  }

  static async findById(id) {
    const doc = await this.collection().doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  static async findByEmail(email) {
    const snap = await this.collection().where('email', '==', email).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  static verifyPassword(password, hashedPassword) {
    return bcrypt.compareSync(password, hashedPassword);
  }

  static async getChildren(parentId) {
    const snap = await this.collection().where('parent_id', '==', parentId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  static async getAllFathers() {
    const snap = await this.collection().where('account_type', '==', 'father').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  static async getWalletAddress(userId) {
    const doc = await this.collection().doc(userId).get();
    if (!doc.exists) return null;
    return doc.data().wallet_address_url;
  }

  static async getIlpKey(userId) {
    const doc = await this.collection().doc(userId).get();
    if (!doc.exists) return null;
    return doc.data().ilp_key_id;
  }
  static async getIlpPrivateKeyPath(userId) {
    const doc = await this.collection().doc(userId).get();
    if (!doc.exists) return null;
    return doc.data().ilp_private_key_path;
  }
}

module.exports = User;
