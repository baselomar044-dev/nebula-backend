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

// Model mapping
const MODEL_MAP = {
  'auto': { provider: 'claude', model: 'claude-sonnet-4-20250514' },
  'claude-sonnet': { provider: 'claude', model: 'claude-sonnet-4-20250514' },
  'claude-haiku': { provider: 'claude', model: 'claude-3-haiku-20240307' },
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini' },
  'llama-70b': { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  'llama-8b': { provider: 'groq', model: 'llama-3.1-8b-instant' },
  'gemini-flash': { provider: 'gemini', model: 'gemini-2.5-flash-preview-04-17' },
  'gemini-pro': { provider: 'gemini', model: 'gemini-2.5-pro-preview-05-06' }
};

router.post('/chat', async (req, res) => {
  try {
    const { messages, model = 'auto' } = req.body;
    
    // Get correct provider and model
    const config = MODEL_MAP[model] || MODEL_MAP['auto'];
    const provider = config.provider;
    const modelId = config.model;
    
    console.log(`Using provider: ${provider}, model: ${modelId}`);
    
    let response, data, text;
    
    if (provider === 'claude') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'x-api-key': ANTHROPIC_KEY, 
          'anthropic-version': '2023-06-01' 
        },
        body: JSON.stringify({ 
          model: modelId, 
          max_tokens: 4096, 
          system: SYSTEM_PROMPT, 
          messages 
        })
      });
      data = await response.json();
      console.log('Claude response:', JSON.stringify(data).substring(0, 200));
      text = data.content?.[0]?.text || data.error?.message || 'Error: ' + JSON.stringify(data);
      
    } else if (provider === 'openai') {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${OPENAI_KEY}` 
        },
        body: JSON.stringify({ 
          model: modelId, 
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages], 
          max_tokens: 4096 
        })
      });
      data = await response.json();
      text = data.choices?.[0]?.message?.content || data.error?.message || 'Error: ' + JSON.stringify(data);
      
    } else if (provider === 'groq') {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${GROQ_KEY}` 
        },
        body: JSON.stringify({ 
          model: modelId, 
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages], 
          max_tokens: 4096 
        })
      });
      data = await response.json();
      text = data.choices?.[0]?.message?.content || data.error?.message || 'Error: ' + JSON.stringify(data);
      
    } else if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`;
      const geminiMessages = messages.map(m => ({ 
        role: m.role === 'assistant' ? 'model' : 'user', 
        parts: [{ text: m.content }] 
      }));
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: geminiMessages, 
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } 
        })
      });
      data = await response.json();
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || 'Error: ' + JSON.stringify(data);
    }
    
    res.json({ text, model: modelId, provider });
  } catch (err) {
    console.error('AI Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
