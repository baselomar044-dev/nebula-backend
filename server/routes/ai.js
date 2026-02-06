import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// AI Providers Config
const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    getKey: () => process.env.ANTHROPIC_API_KEY
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini'],
    getKey: () => process.env.OPENAI_API_KEY
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    getKey: () => process.env.GROQ_API_KEY
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    getKey: () => process.env.GEMINI_API_KEY
  }
};

const SYSTEM_PROMPT = `You are an expert full-stack developer AI assistant. You help users build web applications, debug code, and solve programming problems.

RULES:
1. Always provide complete, working code
2. Use modern best practices
3. Include helpful comments
4. When creating files, use this format:

**filename.ext**
\`\`\`language
code here
\`\`\`

5. For multi-file projects, create all necessary files
6. Explain your approach briefly before code
7. If you see errors, explain the fix clearly`;

// Smart model selection based on task complexity
function selectModel(message) {
  const complexKeywords = ['build', 'create', 'full', 'complex', 'application', 'system', 'complete', 'production'];
  const isComplex = complexKeywords.some(k => message.toLowerCase().includes(k));
  
  // Priority: Anthropic > OpenAI > Groq > Gemini
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', model: isComplex ? 'claude-sonnet-4-20250514' : 'claude-3-5-haiku-20241022' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', model: isComplex ? 'gpt-4o' : 'gpt-4o-mini' };
  }
  if (process.env.GROQ_API_KEY) {
    return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', model: isComplex ? 'gemini-1.5-pro' : 'gemini-1.5-flash' };
  }
  return null;
}

// STREAMING endpoint (SSE)
router.post('/stream', async (req, res) => {
  const { message, model, context = [] } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  try {
    let selected;
    if (model && model !== 'auto') {
      // Parse model string like "anthropic/claude-sonnet-4-20250514"
      const [provider, modelName] = model.includes('/') ? model.split('/') : ['auto', model];
      if (provider !== 'auto' && PROVIDERS[provider]) {
        selected = { provider, model: modelName };
      } else {
        selected = selectModel(message);
      }
    } else {
      selected = selectModel(message);
    }

    if (!selected) {
      res.write(`data: ${JSON.stringify({ error: 'No AI provider configured' })}\n\n`);
      res.end();
      return;
    }

    const { provider, model: selectedModel } = selected;
    const apiKey = PROVIDERS[provider].getKey();

    // Build messages array
    const messages = [
      ...context.slice(-10), // Last 10 messages for context
      { role: 'user', content: message }
    ];

    let response;

    if (provider === 'anthropic') {
      response = await fetch(PROVIDERS.anthropic.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          })),
          stream: true
        })
      });

      // Stream Anthropic response
      const reader = response.body;
      let buffer = '';
      
      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.delta.text, model: `${provider}/${selectedModel}` })}\n\n`);
              }
            } catch (e) {}
          }
        }
      });

      reader.on('end', () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });

    } else if (provider === 'openai' || provider === 'groq') {
      const url = PROVIDERS[provider].url;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages
          ],
          max_tokens: 8192,
          stream: true
        })
      });

      const reader = response.body;
      let buffer = '';

      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) {
                res.write(`data: ${JSON.stringify({ text, model: `${provider}/${selectedModel}` })}\n\n`);
              }
            } catch (e) {}
          }
        }
      });

      reader.on('end', () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });

    } else if (provider === 'gemini') {
      // Gemini uses different streaming approach
      const url = `${PROVIDERS.gemini.url}/${selectedModel}:streamGenerateContent?key=${apiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
            ...messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }))
          ],
          generationConfig: { maxOutputTokens: 8192 }
        })
      });

      const reader = response.body;
      let buffer = '';

      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        // Gemini returns JSON array chunks
        try {
          const matches = buffer.match(/\{[^{}]*"text"[^{}]*\}/g);
          if (matches) {
            for (const match of matches) {
              const parsed = JSON.parse(match);
              if (parsed.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.text, model: `${provider}/${selectedModel}` })}\n\n`);
              }
            }
          }
        } catch (e) {}
      });

      reader.on('end', () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });
    }

  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Non-streaming endpoint (for compatibility)
router.post('/chat', async (req, res) => {
  const { message, model } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    let selected;
    if (model && model !== 'auto') {
      const [provider, modelName] = model.includes('/') ? model.split('/') : ['auto', model];
      if (provider !== 'auto' && PROVIDERS[provider]) {
        selected = { provider, model: modelName };
      } else {
        selected = selectModel(message);
      }
    } else {
      selected = selectModel(message);
    }

    if (!selected) {
      return res.status(500).json({ error: 'No AI provider configured' });
    }

    const { provider, model: selectedModel } = selected;
    const apiKey = PROVIDERS[provider].getKey();

    let response, data;

    if (provider === 'anthropic') {
      response = await fetch(PROVIDERS.anthropic.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: message }]
        })
      });
      data = await response.json();
      return res.json({ 
        response: data.content?.[0]?.text || 'No response',
        model: `${provider}/${selectedModel}`
      });

    } else if (provider === 'openai' || provider === 'groq') {
      response = await fetch(PROVIDERS[provider].url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message }
          ],
          max_tokens: 8192
        })
      });
      data = await response.json();
      return res.json({
        response: data.choices?.[0]?.message?.content || 'No response',
        model: `${provider}/${selectedModel}`
      });

    } else if (provider === 'gemini') {
      const url = `${PROVIDERS.gemini.url}/${selectedModel}:generateContent?key=${apiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + message }] }],
          generationConfig: { maxOutputTokens: 8192 }
        })
      });
      data = await response.json();
      return res.json({
        response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response',
        model: `${provider}/${selectedModel}`
      });
    }

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available models
router.get('/models', (req, res) => {
  const available = [];
  for (const [provider, config] of Object.entries(PROVIDERS)) {
    if (config.getKey()) {
      for (const model of config.models) {
        available.push({ provider, model, id: `${provider}/${model}` });
      }
    }
  }
  res.json({ models: available });
});

export default router;
