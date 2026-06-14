/**
 * Wallet Manager - Secure encrypted wallet storage
 * 
 * Features:
 * - AES-256-GCM encryption with master password
 * - SQLite database for organized storage
 * - Wallet categories: creator, buyers, hop1, hop2
 * - Import/export functionality
 * - Balance checking
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { Keypair, Connection, PublicKey } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');

const LEGACY_DB_PATH = path.join(__dirname, '../data/wallets.db');
const USER_DATA_BASE = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'vortical')
  : (process.env.HOME
      ? path.join(process.env.HOME, '.vortical')
      : path.join(os.tmpdir(), 'vortical'));

// Migrate from old branding paths if they exist
const OLD_PATHS = ['pumpfun-bot-desktop', 'serp-bot-desktop'].map(name =>
  process.env.APPDATA
    ? path.join(process.env.APPDATA, name, 'data', 'wallets.db')
    : path.join(os.tmpdir(), name, 'data', 'wallets.db')
);

const DB_PATH = path.join(USER_DATA_BASE, 'data', 'wallets.db');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

class WalletManager {
  constructor() {
    this.db = null;
    this.masterKey = null;
    this.unlocked = false;
    this.connection = null;
  }

  /**
   * Initialize database
   */
  initialize(masterPassword) {
    const targetDir = path.dirname(DB_PATH);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // Migrate from old install path (asar.unpacked/data)
    if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
      try {
        fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
        console.log('[WalletManager] Migrated wallets DB from legacy install path');
      } catch (e) {
        console.warn('[WalletManager] DB migration skipped:', e.message);
      }
    }

    // Migrate from old branding paths (pumpfun-bot-desktop, serp-bot-desktop)
    if (!fs.existsSync(DB_PATH)) {
      for (const oldPath of OLD_PATHS) {
        if (fs.existsSync(oldPath)) {
          try {
            fs.copyFileSync(oldPath, DB_PATH);
            console.log(`[WalletManager] Migrated wallets DB from ${oldPath}`);
            break;
          } catch (e) {
            console.warn('[WalletManager] Old path migration skipped:', e.message);
          }
        }
      }
    }

    // Open database
    this.db = new Database(DB_PATH);
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- creator, buyers, hop1, hop2
        name TEXT NOT NULL,
        publicKey TEXT NOT NULL UNIQUE,
        encryptedPrivateKey TEXT NOT NULL,
        iv TEXT NOT NULL,
        authTag TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastUsed INTEGER
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_type ON wallets(type);
      CREATE INDEX IF NOT EXISTS idx_wallet_publicKey ON wallets(publicKey);
    `);

    // Store master password hash for verification
    const passwordHash = this.hashPassword(masterPassword);
    
    const existing = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('passwordHash');
    
    if (!existing) {
      // First time setup
      this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('passwordHash', passwordHash);
      console.log('[WalletManager] Initialized with new master password');
    } else {
      // Verify password
      if (existing.value !== passwordHash) {
        throw new Error('Invalid master password');
      }
    }

    // Derive encryption key from password
    this.masterKey = this.deriveKey(masterPassword);
    this.unlocked = true;

    console.log('[WalletManager] Initialized and unlocked');
  }

  /**
   * Unlock wallet manager with master password
   */
  unlock(masterPassword) {
    if (!this.db) {
      this.db = new Database(DB_PATH);
    }

    const stored = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('passwordHash');
    
    if (!stored) {
      throw new Error('Wallet manager not initialized');
    }

    const passwordHash = this.hashPassword(masterPassword);
    
    if (stored.value !== passwordHash) {
      return false;
    }

    this.masterKey = this.deriveKey(masterPassword);
    this.unlocked = true;
    
    console.log('[WalletManager] Unlocked');
    return true;
  }

  /**
   * Check if wallet manager is unlocked
   */
  isUnlocked() {
    return this.unlocked;
  }

  /**
   * Lock wallet manager
   */
  lock() {
    this.masterKey = null;
    this.unlocked = false;
    console.log('[WalletManager] Locked');
  }

  /**
   * Import wallets from JSON files or objects
   */
  async importWallets(type, wallets) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const imported = [];
    
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      
      try {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey || wallet.privateKey));
        const name = wallet.name || `${type}-${i + 1}`;
        
        await this.addWallet(type, name, keypair);
        imported.push({
          name,
          publicKey: keypair.publicKey.toBase58()
        });
      } catch (error) {
        console.error(`Failed to import wallet ${i}:`, error.message);
      }
    }

    console.log(`[WalletManager] Imported ${imported.length} ${type} wallets`);
    
    return {
      success: true,
      imported: imported.length,
      wallets: imported
    };
  }

  /**
   * Generate new wallets
   */
  async generateWallets(type, count) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const generated = [];
    
    for (let i = 0; i < count; i++) {
      const keypair = Keypair.generate();
      const name = `${type}-${i + 1}`;
      
      await this.addWallet(type, name, keypair);
      generated.push({
        name,
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Array.from(keypair.secretKey) // For export
      });
    }

    console.log(`[WalletManager] Generated ${count} ${type} wallets`);
    
    return generated;
  }

  /**
   * Add a wallet to the database
   */
  async addWallet(type, name, keypair) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const publicKey = keypair.publicKey.toBase58();
    const secretKey = Buffer.from(keypair.secretKey);

    // Encrypt private key
    const { encrypted, iv, authTag } = this.encrypt(secretKey);

    // Store in database
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO wallets (type, name, publicKey, encryptedPrivateKey, iv, authTag, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      type,
      name,
      publicKey,
      encrypted,
      iv,
      authTag,
      Date.now()
    );

    return { name, publicKey };
  }

  /**
   * Get wallet by public key
   */
  getWallet(publicKey) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const row = this.db.prepare('SELECT * FROM wallets WHERE publicKey = ?').get(publicKey);
    
    if (!row) {
      return null;
    }

    // Decrypt private key
    const secretKey = this.decrypt(row.encryptedPrivateKey, row.iv, row.authTag);
    const keypair = Keypair.fromSecretKey(secretKey);

    return {
      type: row.type,
      name: row.name,
      keypair,
      publicKey: keypair.publicKey.toBase58()
    };
  }

  /**
   * Get all wallets of a specific type
   */
  getWalletsByType(type) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const rows = this.db.prepare('SELECT * FROM wallets WHERE type = ? ORDER BY createdAt').all(type);
    
    return rows.map(row => {
      const secretKey = this.decrypt(row.encryptedPrivateKey, row.iv, row.authTag);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      return {
        type: row.type,
        name: row.name,
        keypair,
        publicKey: keypair.publicKey.toBase58()
      };
    });
  }

  /**
   * List all wallets (without private keys)
   */
  listWallets() {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    const rows = this.db.prepare('SELECT type, name, publicKey, createdAt FROM wallets ORDER BY type, createdAt').all();
    
    // Group by type
    const grouped = {
      creator: [],
      buyers: [],
      hop1: [],
      hop2: []
    };

    rows.forEach(row => {
      grouped[row.type]?.push({
        name: row.name,
        publicKey: row.publicKey,
        createdAt: row.createdAt
      });
    });

    return grouped;
  }

  /**
   * Get wallet balances
   */
  async getBalances(connection, tokenMint = null) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    if (!connection) {
      throw new Error('Connection required');
    }

    const wallets = this.db.prepare('SELECT publicKey, type, name FROM wallets').all();
    const balances = [];

    for (const wallet of wallets) {
      try {
        const pubkey = new PublicKey(wallet.publicKey);
        
        // Get SOL balance
        const solBalance = await connection.getBalance(pubkey);
        
        let tokenBalance = 0;
        if (tokenMint) {
          try {
            const ata = await getAssociatedTokenAddress(new PublicKey(tokenMint), pubkey);
            const tokenAccount = await getAccount(connection, ata);
            tokenBalance = Number(tokenAccount.amount);
          } catch (e) {
            // No token account
          }
        }

        balances.push({
          type: wallet.type,
          name: wallet.name,
          publicKey: wallet.publicKey,
          sol: solBalance / 1e9,
          tokens: tokenBalance
        });
      } catch (error) {
        console.error(`Failed to get balance for ${wallet.publicKey}:`, error.message);
      }
    }

    return balances;
  }

  /**
   * Export wallets for backup
   */
  exportWallets(type = null) {
    if (!this.unlocked) {
      throw new Error('Wallet manager is locked');
    }

    let query = 'SELECT * FROM wallets';
    let params = [];
    
    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY type, createdAt';

    const rows = this.db.prepare(query).all(...params);
    
    return rows.map(row => {
      const secretKey = this.decrypt(row.encryptedPrivateKey, row.iv, row.authTag);
      
      return {
        type: row.type,
        name: row.name,
        publicKey: row.publicKey,
        secretKey: Array.from(secretKey)
      };
    });
  }

  /**
   * Encrypt data with master key
   */
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt data with master key
   */
  decrypt(encryptedHex, ivHex, authTagHex) {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.masterKey,
      Buffer.from(ivHex, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(Buffer.from(encryptedHex, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }

  /**
   * Hash password for storage
   */
  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Derive encryption key from password using a unique per-install salt.
   * Salt is generated once on first use and stored in the local DB.
   * Never leaves the user's machine.
   */
  deriveKey(password) {
    let saltRow = this.db.prepare("SELECT value FROM settings WHERE key = 'kdfSalt'").get();
    if (!saltRow) {
      const salt = crypto.randomBytes(32).toString('hex');
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('kdfSalt', ?)").run(salt);
      saltRow = { value: salt };
      console.log('[WalletManager] Generated new unique KDF salt');
    }
    return crypto.scryptSync(password, saltRow.value, 32);
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.lock();
  }
}

// Singleton instance
const walletManager = new WalletManager();

module.exports = walletManager;
