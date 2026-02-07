import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307'],
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

const SYSTEM_PROMPT = `You are an expert full-stack developer AI. Build complete, working web applications.

RULES:
1. ALWAYS generate complete, working code
2. For web apps, include HTML, CSS, and JavaScript
3. Use this format for files:

**filename.ext**
\`\`\`language
code here
\`\`\`

4. Create all necessary files for the project
5. Make it visually appealing with modern CSS
6. Include interactivity with JavaScript
7. Test mentally before providing code

IMPORTANT: When user says "fix" or "preview", generate complete fixed code.`;

function selectModel(message) {
  const complexKeywords = ['build', 'create', 'full', 'complex', 'application', 'system', 'complete', 'app'];
  const isComplex = complexKeywords.some(k => message.toLowerCase().includes(k));
  
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', model: isComplex ? 'claude-sonnet-4-20250514' : 'claude-3-haiku-20240307' };
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

function parseModel(model, message) {
  if (!model || model === 'auto') {
    return selectModel(message);
  }
  const [provider, modelName] = model.includes('/') ? model.split('/') : ['auto', model];
  if (provider !== 'auto' && PROVIDERS[provider]) {
    return { provider, model: modelName || PROVIDERS[provider].models[0] };
  }
  return selectModel(message);
}

// STREAMING endpoint
router.post('/stream', async (req, res) => {
  const { message, model, context = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const selected = parseModel(model, message);
  if (!selected) {
    res.write(`data: ${JSON.stringify({ error: 'No AI provider configured' })}\n\n`);
    return res.end();
  }

  const { provider, model: selectedModel } = selected;
  const apiKey = PROVIDERS[provider].getKey();
  const messages = [...context.slice(-10), { role: 'user', content: message }];

  try {
    if (provider === 'anthropic') {
      const response = await fetch(PROVIDERS.anthropic.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          stream: true
        })
      });

      const reader = response.body;
      let buffer = '';
      
      reader.on('data', chunk => {
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
      const response = await fetch(PROVIDERS[provider].url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          max_tokens: 4096,
          stream: true
        })
      });

      const reader = response.body;
      let buffer = '';

      reader.on('data', chunk => {
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
      // Gemini doesn't support streaming easily, fall back to regular
      const url = `${PROVIDERS.gemini.url}/${selectedModel}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + message }] }],
          generationConfig: { maxOutputTokens: 8192 }
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
      res.write(`data: ${JSON.stringify({ text, model: `${provider}/${selectedModel}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// NON-STREAMING endpoint
router.post('/chat', async (req, res) => {
  const { message, model } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const selected = parseModel(model, message);
  if (!selected) return res.status(500).json({ error: 'No AI provider configured' });

  const { provider, model: selectedModel } = selected;
  const apiKey = PROVIDERS[provider].getKey();

  try {
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
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: message }]
        })
      });
      data = await response.json();
      const text = data.content?.[0]?.text || data.error?.message || 'No response';
      return res.json({ response: text, model: `${provider}/${selectedModel}` });

    } else if (provider === 'openai' || provider === 'groq') {
      response = await fetch(PROVIDERS[provider].url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: message }],
          max_tokens: 4096
        })
      });
      data = await response.json();
      return res.json({ response: data.choices?.[0]?.message?.content || data.error?.message || 'No response', model: `${provider}/${selectedModel}` });

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
      return res.json({ response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response', model: `${provider}/${selectedModel}` });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
