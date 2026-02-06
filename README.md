# Nebula AI - Backend

Express.js + SQLite backend for Nebula AI. Deploy to **Railway**.

## Setup

1. Push to GitHub
2. Connect to Railway
3. Set environment variables (see below)
4. Deploy!

## Environment Variables

```env
NODE_ENV=production
JWT_SECRET=your-random-secret
SESSION_SECRET=your-session-secret
FRONTEND_URL=https://your-app.vercel.app

# At least one AI key required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Local Development

```bash
cp .env.example .env
# Edit .env with your values
npm install
npm run dev
```

## API Endpoints

- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `POST /api/ai/chat` - AI chat
- `GET /api/health` - Health check
