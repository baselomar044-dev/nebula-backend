export default {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  database: {
    path: process.env.DATABASE_URL || './database/nebula.db'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: '7d'
  },
  ai: {
    defaultModel: 'auto',
    providers: {
      anthropic: {
        models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
        costPer1kInput: { 'claude-3-5-sonnet-20241022': 0.003, 'claude-3-haiku-20240307': 0.00025 },
        costPer1kOutput: { 'claude-3-5-sonnet-20241022': 0.015, 'claude-3-haiku-20240307': 0.00125 }
      },
      openai: {
        models: ['gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini'],
        costPer1kInput: { 'gpt-4-turbo': 0.01, 'gpt-4o': 0.005, 'gpt-4o-mini': 0.00015 },
        costPer1kOutput: { 'gpt-4-turbo': 0.03, 'gpt-4o': 0.015, 'gpt-4o-mini': 0.0006 }
      },
      google: {
        models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
        costPer1kInput: { 'gemini-1.5-pro': 0.00125, 'gemini-1.5-flash': 0.000075 },
        costPer1kOutput: { 'gemini-1.5-pro': 0.005, 'gemini-1.5-flash': 0.0003 }
      },
      groq: {
        models: ['llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
        costPer1kInput: { 'llama-3.1-70b-versatile': 0.00059, 'mixtral-8x7b-32768': 0.00024 },
        costPer1kOutput: { 'llama-3.1-70b-versatile': 0.00079, 'mixtral-8x7b-32768': 0.00024 }
      },
      deepseek: {
        models: ['deepseek-coder', 'deepseek-chat'],
        costPer1kInput: { 'deepseek-coder': 0.00014, 'deepseek-chat': 0.00014 },
        costPer1kOutput: { 'deepseek-coder': 0.00028, 'deepseek-chat': 0.00028 }
      }
    }
  },
  upload: {
    maxSize: 50 * 1024 * 1024,
    allowedTypes: ['image/*', 'text/*', 'application/json', 'application/zip']
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
};
