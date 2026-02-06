import { Router } from 'express';
import vm from 'vm';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

// Execute JavaScript in sandbox (limited)
router.post('/js', async (req, res) => {
  const { code, timeout = 5000 } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  const output = [];
  const errors = [];
  
  try {
    const sandbox = {
      console: {
        log: (...args) => output.push(args.map(formatOutput).join(' ')),
        error: (...args) => errors.push(args.map(formatOutput).join(' ')),
        warn: (...args) => output.push('[WARN] ' + args.map(formatOutput).join(' ')),
        info: (...args) => output.push('[INFO] ' + args.map(formatOutput).join(' '))
      },
      Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1000)),
      Promise,
      result: null
    };

    vm.createContext(sandbox);
    const script = new vm.Script(`result = (function() { ${code} })()`);
    script.runInContext(sandbox, { timeout });

    res.json({
      success: true,
      output: output.join('\n'),
      errors: errors.join('\n'),
      result: formatOutput(sandbox.result)
    });
    
  } catch (error) {
    res.json({
      success: false,
      output: output.join('\n'),
      errors: error.message,
      result: null
    });
  }
});

// Execute shell command (very restricted)
router.post('/shell', async (req, res) => {
  const { command, timeout = 5000 } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command required' });
  }

  const allowedCommands = ['echo', 'cat', 'ls', 'pwd', 'date', 'whoami', 'node', 'npm'];
  const firstWord = command.trim().split(/\s+/)[0];
  
  if (!allowedCommands.includes(firstWord)) {
    return res.status(403).json({ 
      error: `Command '${firstWord}' not allowed. Allowed: ${allowedCommands.join(', ')}` 
    });
  }

  try {
    const output = await new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        timeout,
        maxBuffer: 1024 * 1024,
        cwd: os.tmpdir()
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });
      
      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code });
      });
      
      proc.on('error', reject);
      
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Timeout'));
      }, timeout);
    });
    
    res.json({
      success: output.exitCode === 0,
      output: output.stdout,
      errors: output.stderr,
      exitCode: output.exitCode
    });
    
  } catch (error) {
    res.json({
      success: false,
      output: '',
      errors: error.message,
      exitCode: 1
    });
  }
});

// Analyze web code
router.post('/web', async (req, res) => {
  const { html, css, js } = req.body;
  
  if (!html && !css && !js) {
    return res.status(400).json({ error: 'At least one of html, css, or js required' });
  }

  const issues = [];
  const suggestions = [];
  
  if (html) {
    if (!html.includes('<!DOCTYPE')) {
      issues.push({ type: 'warning', message: 'Missing DOCTYPE declaration' });
    }
    if (!html.includes('<meta name="viewport"')) {
      suggestions.push('Add viewport meta tag for mobile responsiveness');
    }
  }
  
  if (css) {
    if (!css.includes('box-sizing')) {
      suggestions.push('Consider adding box-sizing: border-box');
    }
  }
  
  if (js) {
    if (js.includes('var ')) {
      suggestions.push('Use let/const instead of var');
    }
    if (js.includes('eval(')) {
      issues.push({ type: 'error', message: 'Avoid using eval() - security risk' });
    }
    
    try {
      new Function(js);
    } catch (e) {
      issues.push({ type: 'error', message: `JavaScript syntax error: ${e.message}` });
    }
  }
  
  res.json({
    success: issues.filter(i => i.type === 'error').length === 0,
    issues,
    suggestions
  });
});

function formatOutput(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }
  return String(value);
}

export default router;
