import { Router } from 'express';
import db from '../../database/index.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const existing = db.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const user = await db.createUser({ email, password, name });
    const token = generateToken(user.id);
    
    res.json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const user = await db.validatePassword(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user.id);
    res.json({ user, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Update profile
router.put('/me', authMiddleware, (req, res) => {
  try {
    const user = db.updateUser(req.userId, req.body);
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save API key
router.post('/api-keys', authMiddleware, (req, res) => {
  try {
    const { provider, key } = req.body;
    // In production, encrypt the key before storing
    const encrypted = Buffer.from(key).toString('base64');
    db.saveApiKey(req.userId, provider, encrypted);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get API keys (just providers, not actual keys)
router.get('/api-keys', authMiddleware, (req, res) => {
  try {
    const keys = db.getApiKeys(req.userId);
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
