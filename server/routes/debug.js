import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Common error patterns and fixes
const ERROR_PATTERNS = {
  javascript: [
    { pattern: /(\w+) is not defined/i, fix: 'Declare the variable before using it: let $1 = ...' },
    { pattern: /Cannot read propert(y|ies) of (undefined|null)/i, fix: 'Check if the object exists before accessing properties: obj?.property or obj && obj.property' },
    { pattern: /Unexpected token/i, fix: 'Check for syntax errors: missing brackets, quotes, or semicolons' },
    { pattern: /is not a function/i, fix: 'Verify the variable is a function before calling it' },
    { pattern: /Maximum call stack/i, fix: 'You have infinite recursion. Add a base case to stop recursion.' },
    { pattern: /SyntaxError: Unexpected end of input/i, fix: 'Missing closing bracket or parenthesis' },
    { pattern: /Assignment to constant variable/i, fix: 'Use let instead of const if you need to reassign the variable' },
    { pattern: /Failed to fetch/i, fix: 'Check if the API URL is correct and CORS is enabled on the server' },
    { pattern: /NetworkError/i, fix: 'Check network connection and API endpoint availability' },
    { pattern: /JSON\.parse/i, fix: 'Ensure the string is valid JSON before parsing' }
  ],
  css: [
    { pattern: /Unknown property/i, fix: 'Check the CSS property name for typos' },
    { pattern: /Invalid property value/i, fix: 'Verify the property value is valid for this property' },
    { pattern: /Expected.*but found/i, fix: 'Check for missing semicolons or brackets' }
  ],
  html: [
    { pattern: /Unclosed tag/i, fix: 'Add the closing tag for the element' },
    { pattern: /Duplicate attribute/i, fix: 'Remove the duplicate attribute' },
    { pattern: /Invalid attribute/i, fix: 'Check if the attribute is valid for this element' }
  ]
};

// Analyze code for errors
router.post('/analyze', async (req, res) => {
  const { code, language = 'javascript', error } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  const issues = [];
  const suggestions = [];

  try {
    if (language === 'javascript' || language === 'js') {
      // Try to parse JavaScript
      try {
        new Function(code);
      } catch (e) {
        issues.push({
          type: 'error',
          line: extractLineNumber(e.message),
          message: e.message,
          fix: getSuggestedFix(e.message, 'javascript')
        });
      }

      // Check for common issues
      const lines = code.split('\n');
      lines.forEach((line, idx) => {
        // Console.log in production
        if (line.includes('console.log')) {
          suggestions.push({ line: idx + 1, message: 'Remove console.log before production' });
        }
        
        // var usage
        if (/\bvar\s+/.test(line)) {
          suggestions.push({ line: idx + 1, message: 'Use let or const instead of var' });
        }
        
        // == instead of ===
        if (/[^=!]==[^=]/.test(line)) {
          suggestions.push({ line: idx + 1, message: 'Use === for strict equality' });
        }
        
        // Missing semicolon (basic check)
        const trimmed = line.trim();
        if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('{') && 
            !trimmed.endsWith('}') && !trimmed.endsWith(',') &&
            !trimmed.startsWith('//') && !trimmed.startsWith('/*') &&
            !trimmed.startsWith('if') && !trimmed.startsWith('else') &&
            !trimmed.startsWith('for') && !trimmed.startsWith('while') &&
            !trimmed.startsWith('function') && !trimmed.startsWith('class')) {
          // suggestions.push({ line: idx + 1, message: 'Consider adding semicolon' });
        }
      });

    } else if (language === 'html') {
      // Check for unclosed tags
      const openTags = [];
      const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
      const selfClosing = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];
      
      let match;
      while ((match = tagRegex.exec(code)) !== null) {
        const tag = match[1].toLowerCase();
        const isClosing = match[0].startsWith('</');
        const isSelfClose = selfClosing.includes(tag) || match[0].endsWith('/>');
        
        if (!isSelfClose) {
          if (isClosing) {
            if (openTags.length > 0 && openTags[openTags.length - 1] === tag) {
              openTags.pop();
            } else {
              issues.push({ type: 'error', message: `Unexpected closing tag </${tag}>` });
            }
          } else {
            openTags.push(tag);
          }
        }
      }
      
      openTags.forEach(tag => {
        issues.push({ type: 'error', message: `Unclosed tag <${tag}>`, fix: `Add </${tag}>` });
      });

    } else if (language === 'css') {
      // Basic CSS validation
      const bracketCount = (code.match(/{/g) || []).length - (code.match(/}/g) || []).length;
      if (bracketCount !== 0) {
        issues.push({ type: 'error', message: 'Mismatched curly braces', fix: 'Check for missing { or }' });
      }
      
      // Check for common mistakes
      if (code.includes('colour')) {
        suggestions.push({ message: 'Use "color" instead of "colour" (American spelling)' });
      }
    }

    // If an error message was provided, analyze it
    if (error) {
      const fix = getSuggestedFix(error, language);
      if (fix) {
        issues.push({ type: 'error', message: error, fix });
      }
    }

    res.json({
      success: issues.filter(i => i.type === 'error').length === 0,
      issues,
      suggestions,
      summary: {
        errors: issues.filter(i => i.type === 'error').length,
        warnings: issues.filter(i => i.type === 'warning').length,
        suggestions: suggestions.length
      }
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get AI-powered fix suggestion
router.post('/fix', async (req, res) => {
  const { code, error, language = 'javascript' } = req.body;
  
  if (!code || !error) {
    return res.status(400).json({ error: 'Code and error required' });
  }

  try {
    // Try to use AI for fix suggestion
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      // Fallback to pattern matching
      const fix = getSuggestedFix(error, language);
      return res.json({ 
        fix: fix || 'Unable to suggest a fix automatically',
        method: 'pattern'
      });
    }

    const prompt = `Fix this ${language} code error.

ERROR: ${error}

CODE:
\`\`\`${language}
${code}
\`\`\`

Provide ONLY the fixed code, no explanations. If you can't fix it, explain why briefly.`;

    let response, data, fixedCode;

    if (process.env.ANTHROPIC_API_KEY) {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      data = await response.json();
      fixedCode = data.content?.[0]?.text;
    } else if (process.env.OPENAI_API_KEY) {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048
        })
      });
      data = await response.json();
      fixedCode = data.choices?.[0]?.message?.content;
    } else if (process.env.GROQ_API_KEY) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048
        })
      });
      data = await response.json();
      fixedCode = data.choices?.[0]?.message?.content;
    }

    res.json({
      fix: fixedCode || 'Unable to generate fix',
      method: 'ai'
    });

  } catch (e) {
    console.error('Fix error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Quick lint check
router.post('/lint', (req, res) => {
  const { code, language = 'javascript' } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  const warnings = [];
  const lines = code.split('\n');

  if (language === 'javascript' || language === 'js') {
    lines.forEach((line, idx) => {
      // Unused variable pattern (basic)
      const varMatch = line.match(/(?:let|const|var)\s+(\w+)\s*=/);
      if (varMatch) {
        const varName = varMatch[1];
        const restOfCode = lines.slice(idx + 1).join('\n');
        if (!restOfCode.includes(varName)) {
          warnings.push({ line: idx + 1, message: `'${varName}' is declared but might be unused` });
        }
      }
      
      // Long lines
      if (line.length > 120) {
        warnings.push({ line: idx + 1, message: 'Line exceeds 120 characters' });
      }
      
      // TODO comments
      if (line.includes('TODO') || line.includes('FIXME')) {
        warnings.push({ line: idx + 1, message: 'Contains TODO/FIXME comment', type: 'info' });
      }
    });
  }

  res.json({
    warnings,
    lineCount: lines.length,
    characterCount: code.length
  });
});

function getSuggestedFix(error, language) {
  const patterns = ERROR_PATTERNS[language] || ERROR_PATTERNS.javascript;
  
  for (const { pattern, fix } of patterns) {
    const match = error.match(pattern);
    if (match) {
      return fix.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] || '');
    }
  }
  
  return null;
}

function extractLineNumber(message) {
  const match = message.match(/line\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

export default router;
