import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

const SYSTEM_PROMPT = `You are an expert web developer AI assistant. When asked to create something:
1. ALWAYS respond with complete, working HTML/CSS/JavaScript code
2. Put CSS in <style> tags and JS in <script> tags within the HTML
3. Make it visually appealing with modern styling
4. Include ALL necessary code - never use placeholders
5. Code should work immediately when rendered
6. Keep responses focused on the code - minimal explanation`;

// Provider configurations
const PROVIDERS = {
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    models: {
      best: 'claude-sonnet-4-20250514',
      fast: 'claude-3-haiku-20240307'
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: {
      best: 'gpt-4o',
      fast: 'gpt-4o-mini'
    }
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: {
      best: 'llama-3.1-70b-versatile',
      fast: 'llama-3.1-8b-instant'
    }
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: {
      best: 'gemini-2.5-flash',
      fast: 'gemini-2.0-flash-lite'
    }
  }
};

// Get provider from model name
function getProvider(model) {
  if (model.includes('claude')) return 'claude';
  if (model.includes('gpt')) return 'openai';
  if (model.includes('llama') || model.includes('mixtral')) return 'groq';
  if (model.includes('gemini')) return 'gemini';
  return 'claude'; // default
}

// Claude API call
async function callClaude(messages, model, stream = false) {
  const response = await fetch(PROVIDERS.claude.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || PROVIDERS.claude.models.best,
      max_tokens: model?.includes('haiku') ? 2048 : 4096,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
      stream
    })
  });
  return response;
}

// OpenAI API call
async function callOpenAI(messages, model, stream = false) {
  const response = await fetch(PROVIDERS.openai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model || PROVIDERS.openai.models.best,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 4096,
      stream
    })
  });
  return response;
}

// Groq API call
async function callGroq(messages, model, stream = false) {
  const response = await fetch(PROVIDERS.groq.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: model || PROVIDERS.groq.models.best,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 4096,
      stream
    })
  });
  return response;
}

// Gemini API call
async function callGemini(messages, model) {
  const modelName = model || PROVIDERS.gemini.models.best;
  const url = `${PROVIDERS.gemini.url}/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
  
  // Add system instruction
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    })
  });
  return response;
}

// NON-STREAMING chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { messages, model } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: 'Messages required' });
    }

    const provider = getProvider(model || 'claude');
    let response, data, text;

    try {
      if (provider === 'claude') {
        response = await callClaude(messages, model);
        data = await response.json();
        text = data.content?.[0]?.text || data.error?.message || 'No response';
      } else if (provider === 'openai') {
        response = await callOpenAI(messages, model);
        data = await response.json();
        text = data.choices?.[0]?.message?.content || data.error?.message || 'No response';
      } else if (provider === 'groq') {
        response = await callGroq(messages, model);
        data = await response.json();
        text = data.choices?.[0]?.message?.content || data.error?.message || 'No response';
      } else if (provider === 'gemini') {
        response = await callGemini(messages, model);
        data = await response.json();
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || 'No response';
      }
    } catch (providerError) {
      // Fallback to Claude if provider fails
      console.error(`${provider} failed, falling back to Claude:`, providerError.message);
      response = await callClaude(messages, PROVIDERS.claude.models.best);
      data = await response.json();
      text = data.content?.[0]?.text || 'Error getting response';
    }

    res.json({ response: text, model: model || 'auto', provider });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// STREAMING chat endpoint
router.post('/stream', async (req, res) => {
  try {
    const { messages, model } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: 'Messages required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const provider = getProvider(model || 'claude');

    try {
      if (provider === 'claude') {
        const response = await callClaude(messages, model, true);
        
        for await (const chunk of response.body) {
          const text = chunk.toString();
          const lines = text.split('\n').filter(l => l.startsWith('data: '));
          
          for (const line of lines) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === 'content_block_delta' && data.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: data.delta.text })}\n\n`);
              }
            } catch (e) {}
          }
        }
      } else if (provider === 'openai' || provider === 'groq') {
        const callFn = provider === 'openai' ? callOpenAI : callGroq;
        const response = await callFn(messages, model, true);
        
        for await (const chunk of response.body) {
          const text = chunk.toString();
          const lines = text.split('\n').filter(l => l.startsWith('data: '));
          
          for (const line of lines) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;
            try {
              const data = JSON.parse(jsonStr);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
              }
            } catch (e) {}
          }
        }
      } else if (provider === 'gemini') {
        // Gemini doesn't support streaming the same way, do regular call
        const response = await callGemini(messages, model);
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Simulate streaming by sending in chunks
        const words = text.split(' ');
        for (let i = 0; i < words.length; i++) {
          res.write(`data: ${JSON.stringify({ text: words[i] + ' ' })}\n\n`);
          await new Promise(r => setTimeout(r, 20));
        }
      }
    } catch (providerError) {
      console.error(`${provider} streaming failed:`, providerError.message);
      res.write(`data: ${JSON.stringify({ text: `Error: ${providerError.message}. Try another model.` })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List available models
router.get('/models', (req, res) => {
  res.json({
    providers: {
      claude: { models: Object.values(PROVIDERS.claude.models), status: 'active' },
      openai: { models: Object.values(PROVIDERS.openai.models), status: 'active' },
      groq: { models: Object.values(PROVIDERS.groq.models), status: 'check' },
      gemini: { models: Object.values(PROVIDERS.gemini.models), status: 'check' }
    }
  });
});

export default router;
