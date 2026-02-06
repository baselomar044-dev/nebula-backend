import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Get API keys from environment variables
function getEnvKeys() {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    tavily: process.env.TAVILY_API_KEY
  };
}

// Smart model selection
function selectBestModel(task, availableKeys) {
  const complexity = analyzeComplexity(task);
  
  if (complexity === 'high') {
    if (availableKeys.anthropic) return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
    if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o' };
    if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-pro' };
  }
  
  if (complexity === 'medium') {
    if (availableKeys.groq) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-flash' };
    if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o-mini' };
  }
  
  // Low complexity - cheapest
  if (availableKeys.groq) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
  if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-flash' };
  if (availableKeys.anthropic) return { provider: 'anthropic', model: 'claude-3-haiku-20240307' };
  if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o-mini' };
  
  return null;
}

function analyzeComplexity(task) {
  const lowKeywords = ['fix typo', 'rename', 'simple', 'add comment', 'format', 'hello'];
  const highKeywords = ['architect', 'design system', 'complex', 'full app', 'database', 'api design', 'refactor'];
  
  const taskLower = task.toLowerCase();
  
  if (highKeywords.some(k => taskLower.includes(k))) return 'high';
  if (lowKeywords.some(k => taskLower.includes(k))) return 'low';
  if (task.length > 500) return 'high';
  if (task.length < 100) return 'low';
  
  return 'medium';
}

async function callAI(provider, model, messages, apiKey) {
  let response, result;
  
  if (provider === 'anthropic') {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
      })
    });
    result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.content[0].text;
  }
  
  if (provider === 'openai' || provider === 'groq') {
    const url = provider === 'openai' 
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
    
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, max_tokens: 4096 })
    });
    result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.choices[0].message.content;
  }
  
  if (provider === 'google') {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }))
      })
    });
    result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.candidates[0].content.parts[0].text;
  }
  
  throw new Error('Unknown provider');
}

// Main chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message, context, model: requestedModel, temperature } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Get available API keys from env
    const envKeys = getEnvKeys();
    const availableKeys = {};
    
    for (const [provider, key] of Object.entries(envKeys)) {
      if (key) availableKeys[provider] = key;
    }
    
    if (Object.keys(availableKeys).length === 0) {
      return res.status(400).json({ error: 'No API keys configured in environment variables.' });
    }
    
    // Select model
    let provider, model;
    if (requestedModel && requestedModel !== 'auto') {
      // Parse model string like "openai/gpt-4o"
      [provider, model] = requestedModel.includes('/') ? requestedModel.split('/') : ['auto', requestedModel];
    }
    
    if (!provider || provider === 'auto') {
      const selected = selectBestModel(message, availableKeys);
      if (!selected) {
        return res.status(400).json({ error: 'No suitable model available' });
      }
      provider = selected.provider;
      model = selected.model;
    }
    
    const apiKey = availableKeys[provider];
    if (!apiKey) {
      return res.status(400).json({ error: `No API key for ${provider}` });
    }
    
    // Build messages
    const systemPrompt = `You are an expert AI coding assistant. You help build web applications, write clean code, and explain concepts clearly.
When generating code, always provide complete, working examples. Use modern best practices.
If files are provided as context, reference them when relevant.`;
    
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    if (context) {
      messages.push({ role: 'user', content: `Current project files:\n${context}` });
      messages.push({ role: 'assistant', content: 'I have reviewed your project files. How can I help?' });
    }
    
    messages.push({ role: 'user', content: message });
    
    // Call AI
    const response = await callAI(provider, model, messages, apiKey);
    
    res.json({ 
      response,
      model: `${provider}/${model}`
    });
    
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Models endpoint
router.get('/models', (req, res) => {
  const envKeys = getEnvKeys();
  const models = [];
  
  if (envKeys.anthropic) {
    models.push(
      { id: 'anthropic/claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
    );
  }
  if (envKeys.openai) {
    models.push(
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' }
    );
  }
  if (envKeys.google) {
    models.push(
      { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
    );
  }
  if (envKeys.groq) {
    models.push(
      { id: 'groq/llama-3.3-70b-versatile', name: 'Llama 3.3 70B' }
    );
  }
  
  res.json({ models });
});

export default router;
