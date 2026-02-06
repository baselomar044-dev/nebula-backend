import jwt from 'jsonwebtoken';
import db from '../../database/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.getUserById(decoded.userId);
      if (user) {
        req.user = user;
        req.userId = user.id;
      }
    }
  } catch (e) {}
  next();
}

export function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
