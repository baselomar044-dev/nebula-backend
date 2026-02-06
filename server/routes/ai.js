import { Router } from 'express';
import fetch from 'node-fetch';
import db from '../../database/index.js';
import config from '../../config/default.js';

const router = Router();

// Smart model selection based on task complexity and cost
function selectBestModel(task, availableKeys) {
  const complexity = analyzeComplexity(task);
  
  // Priority: Best quality for complex, cheapest for simple
  if (complexity === 'high') {
    if (availableKeys.anthropic) return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
    if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o' };
    if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-pro' };
  }
  
  if (complexity === 'medium') {
    if (availableKeys.groq) return { provider: 'groq', model: 'llama-3.1-70b-versatile' };
    if (availableKeys.deepseek) return { provider: 'deepseek', model: 'deepseek-coder' };
    if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-flash' };
    if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o-mini' };
  }
  
  // Low complexity - cheapest options
  if (availableKeys.deepseek) return { provider: 'deepseek', model: 'deepseek-chat' };
  if (availableKeys.groq) return { provider: 'groq', model: 'mixtral-8x7b-32768' };
  if (availableKeys.google) return { provider: 'google', model: 'gemini-1.5-flash' };
  if (availableKeys.anthropic) return { provider: 'anthropic', model: 'claude-3-haiku-20240307' };
  if (availableKeys.openai) return { provider: 'openai', model: 'gpt-4o-mini' };
  
  return null;
}

function analyzeComplexity(task) {
  const lowKeywords = ['fix typo', 'rename', 'simple', 'add comment', 'format'];
  const highKeywords = ['architect', 'design system', 'complex', 'full app', 'database schema', 'api design', 'refactor entire'];
  
  const taskLower = task.toLowerCase();
  
  if (highKeywords.some(k => taskLower.includes(k))) return 'high';
  if (lowKeywords.some(k => taskLower.includes(k))) return 'low';
  if (task.length > 500) return 'high';
  if (task.length < 100) return 'low';
  
  return 'medium';
}

function getApiKey(userId, provider) {
  const keyRecord = db.getApiKey(userId, provider);
  if (!keyRecord) return null;
  return Buffer.from(keyRecord.encrypted_key, 'base64').toString();
}

async function callAI(provider, model, messages, apiKey) {
  const endpoints = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
    google: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions'
  };
  
  let response, result;
  
  if (provider === 'anthropic') {
    response = await fetch(endpoints.anthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content
        }))
      })
    });
    result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return {
      content: result.content[0].text,
      tokensInput: result.usage?.input_tokens || 0,
      tokensOutput: result.usage?.output_tokens || 0
    };
  }
  
  if (provider === 'google') {
    response = await fetch(`${endpoints.google}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      })
    });
    result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return {
      content: result.candidates[0].content.parts[0].text,
      tokensInput: result.usageMetadata?.promptTokenCount || 0,
      tokensOutput: result.usageMetadata?.candidatesTokenCount || 0
    };
  }
  
  // OpenAI-compatible (OpenAI, Groq, DeepSeek)
  response = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 8192
    })
  });
  result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return {
    content: result.choices[0].message.content,
    tokensInput: result.usage?.prompt_tokens || 0,
    tokensOutput: result.usage?.completion_tokens || 0
  };
}

// Chat with AI
router.post('/chat', async (req, res) => {
  try {
    const { projectId, conversationId, message, files, model: requestedModel } = req.body;
    
    // Get available API keys
    const availableKeys = {};
    for (const provider of ['anthropic', 'openai', 'google', 'groq', 'deepseek']) {
      const key = getApiKey(req.userId, provider);
      if (key) availableKeys[provider] = key;
    }
    
    if (Object.keys(availableKeys).length === 0) {
      return res.status(400).json({ error: 'No API keys configured. Add at least one in settings.' });
    }
    
    // Select model
    let provider, model;
    if (requestedModel && requestedModel !== 'auto') {
      // Find which provider has this model
      for (const [p, conf] of Object.entries(config.ai.providers)) {
        if (conf.models.includes(requestedModel) && availableKeys[p]) {
          provider = p;
          model = requestedModel;
          break;
        }
      }
    }
    
    if (!provider) {
      const selected = selectBestModel(message, availableKeys);
      if (!selected) {
        return res.status(400).json({ error: 'No suitable model available' });
      }
      provider = selected.provider;
      model = selected.model;
    }
    
    // Get or create conversation
    let convo;
    if (conversationId) {
      convo = db.getConversation(conversationId);
    } else {
      convo = db.createConversation(projectId, req.userId, message.slice(0, 50));
    }
    
    // Build context
    const projectFiles = projectId ? db.getProjectFiles(projectId) : [];
    const previousMessages = convo ? db.getConversationMessages(convo.id) : [];
    
    const systemPrompt = `You are Nebula AI, an expert coding assistant. You help users build, fix, and deploy applications.

Current project files:
${projectFiles.map(f => f.path).join('\\n') || 'No files yet'}

Guidelines:
- Be concise and direct
- Provide complete, working code
- Explain changes briefly
- Use markdown code blocks with language tags
- If creating/editing files, clearly indicate the file path

When outputting code changes, use this format:
\`\`\`language:path/to/file.ext
// code here
\`\`\``;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...previousMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];
    
    // Add file context if provided
    if (files && files.length) {
      const fileContents = files.map(f => {
        const file = db.getFileByPath(projectId, f);
        return file ? `File: ${f}\\n\`\`\`\\n${file.content}\\n\`\`\`` : '';
      }).filter(Boolean).join('\\n\\n');
      
      messages[messages.length - 1].content += '\\n\\nRelevant files:\\n' + fileContents;
    }
    
    // Save user message
    db.addMessage(convo.id, { role: 'user', content: message });
    
    // Call AI
    const apiKey = availableKeys[provider];
    const result = await callAI(provider, model, messages, apiKey);
    
    // Calculate cost
    const providerConfig = config.ai.providers[provider];
    const cost = (result.tokensInput / 1000 * providerConfig.costPer1kInput[model]) +
                 (result.tokensOutput / 1000 * providerConfig.costPer1kOutput[model]);
    
    // Save assistant message
    const assistantMsg = db.addMessage(convo.id, {
      role: 'assistant',
      content: result.content,
      model,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      cost
    });
    
    // Log usage
    db.logUsage(req.userId, 'ai_chat', { model, provider }, result.tokensInput + result.tokensOutput, cost);
    
    // Parse code blocks for auto-save
    const codeBlocks = parseCodeBlocks(result.content);
    
    res.json({
      conversationId: convo.id,
      message: assistantMsg,
      model,
      provider,
      codeBlocks,
      cost: cost.toFixed(6)
    });
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ error: error.message });
  }
});

function parseCodeBlocks(content) {
  const blocks = [];
  const regex = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      path: match[2] || null,
      code: match[3].trim()
    });
  }
  
  return blocks;
}

// Get available models
router.get('/models', (req, res) => {
  const availableKeys = {};
  for (const provider of ['anthropic', 'openai', 'google', 'groq', 'deepseek']) {
    const key = getApiKey(req.userId, provider);
    if (key) availableKeys[provider] = true;
  }
  
  const models = [];
  for (const [provider, conf] of Object.entries(config.ai.providers)) {
    if (availableKeys[provider]) {
      for (const model of conf.models) {
        models.push({
          provider,
          model,
          costInput: conf.costPer1kInput[model],
          costOutput: conf.costPer1kOutput[model]
        });
      }
    }
  }
  
  res.json({ models, hasKeys: Object.keys(availableKeys).length > 0 });
});

// Analyze project
router.post('/analyze', async (req, res) => {
  try {
    const { projectId } = req.body;
    const files = db.getProjectFiles(projectId);
    
    // Quick analysis without AI
    const analysis = {
      totalFiles: files.length,
      languages: {},
      frameworks: [],
      issues: []
    };
    
    for (const file of files) {
      const ext = file.name.split('.').pop();
      analysis.languages[ext] = (analysis.languages[ext] || 0) + 1;
      
      if (file.name === 'package.json') analysis.frameworks.push('Node.js');
      if (file.name === 'requirements.txt') analysis.frameworks.push('Python');
      if (file.name === 'Cargo.toml') analysis.frameworks.push('Rust');
    }
    
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
