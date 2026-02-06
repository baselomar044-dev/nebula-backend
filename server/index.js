import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import aiRouter from './routes/ai.js';
import gitRouter from './routes/git.js';
import databaseRouter from './routes/database.js';
import executeRouter from './routes/execute.js';
import debugRouter from './routes/debug.js';

const app = express();
const server = createServer(app);

// WebSocket server for real-time features
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    version: '2.0.0',
    features: ['streaming', 'git', 'database', 'execute', 'debug']
  });
});

// API Routes
app.use('/api/ai', aiRouter);
app.use('/api/git', gitRouter);
app.use('/api/db', databaseRouter);
app.use('/api/execute', executeRouter);
app.use('/api/debug', debugRouter);

// Get available features/config
app.get('/api/config', (req, res) => {
  res.json({
    features: {
      ai: !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY),
      streaming: true,
      git: true,
      database: true,
      execute: true,
      debug: true
    },
    models: {
      anthropic: process.env.ANTHROPIC_API_KEY ? ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] : [],
      openai: process.env.OPENAI_API_KEY ? ['gpt-4o', 'gpt-4o-mini'] : [],
      groq: process.env.GROQ_API_KEY ? ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] : [],
      gemini: process.env.GEMINI_API_KEY ? ['gemini-1.5-pro', 'gemini-1.5-flash'] : []
    }
  });
});

// WebSocket handling
const clients = new Map();

wss.on('connection', (ws, req) => {
  const id = Math.random().toString(36).substr(2, 9);
  clients.set(id, ws);
  
  console.log(`WebSocket connected: ${id}`);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Handle different message types
      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
          break;
          
        case 'subscribe':
          ws.subscriptions = ws.subscriptions || new Set();
          ws.subscriptions.add(msg.channel);
          break;
          
        case 'unsubscribe':
          ws.subscriptions?.delete(msg.channel);
          break;
          
        default:
          console.log('Unknown message type:', msg.type);
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });
  
  ws.on('close', () => {
    clients.delete(id);
    console.log(`WebSocket disconnected: ${id}`);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({ 
    type: 'connected', 
    id,
    message: 'Connected to AI App backend'
  }));
});

// Broadcast to all connected clients
function broadcast(message, channel = null) {
  const data = JSON.stringify(message);
  clients.forEach((ws) => {
    if (ws.readyState === 1) {
      if (!channel || ws.subscriptions?.has(channel)) {
        ws.send(data);
      }
    }
  });
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║           AI App Backend v2.0             ║
╠═══════════════════════════════════════════╣
║  Server running on port ${PORT}              ║
║                                           ║
║  Features:                                ║
║  ✓ Streaming AI responses                 ║
║  ✓ Git integration                        ║
║  ✓ Database support                       ║
║  ✓ Code execution                         ║
║  ✓ Error debugging                        ║
║  ✓ WebSocket real-time                    ║
╚═══════════════════════════════════════════╝
  `);
});

export { broadcast };
