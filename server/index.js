import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

import db from '../database/index.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import aiRoutes from './routes/ai.js';
import deployRoutes from './routes/deploy.js';
import fileRoutes from './routes/files.js';
import { errorHandler } from './middleware/error.js';
import { authMiddleware } from './middleware/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Initialize database
db.init();

// CORS Configuration - Allow frontend URLs
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,  // Your Vercel URL
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Security & Performance
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Static files (for local development or if serving from same server)
app.use(express.static(join(__dirname, '../client/public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/deploy', authMiddleware, deployRoutes);
app.use('/api/files', authMiddleware, fileRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback (for local development)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../client/public/index.html'));
});

// Error handler
app.use(errorHandler);

// WebSocket for real-time updates
const clients = new Map();

wss.on('connection', (ws, req) => {
  const id = Date.now().toString();
  clients.set(id, ws);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Handle different message types
      if (msg.type === 'subscribe') {
        ws.projectId = msg.projectId;
      }
    } catch (e) {}
  });
  
  ws.on('close', () => clients.delete(id));
});

export function broadcast(projectId, data) {
  clients.forEach(ws => {
    if (ws.projectId === projectId && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║     ✨ NEBULA AI - Ready!             ║
║     http://localhost:${PORT}             ║
╚═══════════════════════════════════════╝
  `);
});

export default app;
