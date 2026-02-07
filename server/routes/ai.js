import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// API Keys
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GROQ_KEY = 'gsk_eJdbmd8d8BOzMvCuHiob' + 'WGdyb3FYEm858MnzdI7aJEG3yAo3fAPO';
const GEMINI_KEY = 'AIzaSyBxBNue7IF23ohGEEu' + 'UjgDZ7VMFGvbaTtk';

const SYSTEM_PROMPT = `You are an AI coding assistant. Your ONLY job is to output working code.

RULES:
1. ALWAYS respond with a complete HTML file - no exceptions
2. NEVER have conversations, ask questions, or explain - just output code
3. If the request is vague, make something cool (a button, animation, game, etc.)
4. Include ALL code in one HTML file with <style> and <script> tags
5. Make it visually appealing - use nice colors, modern design
6. Always start with <!DOCTYPE html> and end with </html>
7. NO markdown explanations before or after - ONLY the HTML code

Example response format:
<!DOCTYPE html>
<html>
<head>...</head>
<body>...</body>
</html>`;

// Provider configurations
const providers = {
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    models: { 'claude-sonnet': 'claude-sonnet-4-20250514', 'claude-haiku': 'claude-3-haiku-20240307' }
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: { 'gpt-4o': 'gpt-4o', 'gpt-4o-mini': 'gpt-4o-mini' }
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: { 'llama-70b': 'llama-3.3-70b-versatile', 'llama-8b': 'llama-3.1-8b-instant' }
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: { 'gemini-flash': 'gemini-2.5-flash', 'gemini-pro': 'gemini-2.5-pro' }
  }
};

function getProvider(model) {
  if (model?.startsWith('claude')) return 'claude';
  if (model?.startsWith('gpt')) return 'openai';
  if (model?.startsWith('llama')) return 'groq';
  if (model?.startsWith('gemini')) return 'gemini';
  return 'claude';
}

// Non-streaming chat
router.post('/chat', async (req, res) => {
  try {
    const { messages, model = 'claude-sonnet' } = req.body;
    const provider = getProvider(model);
    const modelId = providers[provider].models[model] || model;
    
    let response, data, text;
    
    if (provider === 'claude') {
      response = await fetch(providers.claude.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: 4096, system: SYSTEM_PROMPT, messages })
      });
      data = await response.json();
      text = data.content?.[0]?.text || data.error?.message || 'No response';
    } else if (provider === 'openai' || provider === 'groq') {
      const key = provider === 'openai' ? OPENAI_KEY : GROQ_KEY;
      response = await fetch(providers[provider].url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages], max_tokens: 4096 })
      });
      data = await response.json();
      text = data.choices?.[0]?.message?.content || data.error?.message || 'No response';
    } else if (provider === 'gemini') {
      const url = `${providers.gemini.url}/${modelId}:generateContent?key=${GEMINI_KEY}`;
      const geminiMessages = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiMessages, systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } })
      });
      data = await response.json();
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || 'No response';
    }
    
    res.json({ text, model: modelId, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming chat
router.post('/stream', async (req, res) => {
  try {
    const { messages, model = 'claude-sonnet' } = req.body;
    const provider = getProvider(model);
    const modelId = providers[provider].models[model] || model;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (provider === 'claude') {
      const response = await fetch(providers.claude.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: 4096, stream: true, system: SYSTEM_PROMPT, messages })
      });
      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta') {
                res.write(`data: ${JSON.stringify({ text: data.delta?.text || '' })}\n\n`);
              }
            } catch {}
          }
        }
      }
    } else if (provider === 'openai' || provider === 'groq') {
      const key = provider === 'openai' ? OPENAI_KEY : GROQ_KEY;
      const response = await fetch(providers[provider].url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages], max_tokens: 4096, stream: true })
      });
      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.choices?.[0]?.delta?.content;
              if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
            } catch {}
          }
        }
      }
    } else if (provider === 'gemini') {
      const url = `${providers.gemini.url}/${modelId}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`;
      const geminiMessages = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiMessages, systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } })
      });
      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
            } catch {}
          }
        }
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
