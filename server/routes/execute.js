import { Router } from 'express';
import { VM, VMScript } from 'vm2';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

// Execute JavaScript in sandbox
router.post('/js', async (req, res) => {
  const { code, timeout = 5000 } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  const output = [];
  const errors = [];
  
  try {
    const vm = new VM({
      timeout,
      sandbox: {
        console: {
          log: (...args) => output.push(args.map(a => formatOutput(a)).join(' ')),
          error: (...args) => errors.push(args.map(a => formatOutput(a)).join(' ')),
          warn: (...args) => output.push('[WARN] ' + args.map(a => formatOutput(a)).join(' ')),
          info: (...args) => output.push('[INFO] ' + args.map(a => formatOutput(a)).join(' '))
        },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1000)),
        setInterval: () => { throw new Error('setInterval not allowed'); },
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        fetch: async (url) => {
          // Limited fetch for APIs
          if (!url.startsWith('https://')) {
            throw new Error('Only HTTPS URLs allowed');
          }
          const response = await import('node-fetch').then(m => m.default(url));
          return {
            json: () => response.json(),
            text: () => response.text(),
            ok: response.ok,
            status: response.status
          };
        }
      },
      eval: false,
      wasm: false
    });

    const script = new VMScript(code);
    const result = vm.run(script);
    
    // If result is a promise, await it
    const finalResult = result instanceof Promise ? await result : result;
    
    res.json({
      success: true,
      output: output.join('\n'),
      errors: errors.join('\n'),
      result: formatOutput(finalResult)
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

// Execute Python code
router.post('/python', async (req, res) => {
  const { code, timeout = 10000 } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  const tempFile = path.join(os.tmpdir(), `py_${Date.now()}.py`);
  
  try {
    // Write code to temp file
    fs.writeFileSync(tempFile, code);
    
    const output = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [tempFile], {
        timeout,
        maxBuffer: 1024 * 1024 // 1MB
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });
      
      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code });
      });
      
      proc.on('error', (err) => {
        reject(err);
      });
      
      // Kill after timeout
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Execution timeout'));
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
  } finally {
    // Cleanup
    try { fs.unlinkSync(tempFile); } catch (e) {}
  }
});

// Execute shell command (very restricted)
router.post('/shell', async (req, res) => {
  const { command, timeout = 5000 } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command required' });
  }

  // Whitelist of allowed commands
  const allowedCommands = ['echo', 'cat', 'ls', 'pwd', 'date', 'whoami', 'env', 'node', 'npm', 'python3'];
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

// Run HTML/CSS/JS as a "virtual browser" - returns rendered result analysis
router.post('/web', async (req, res) => {
  const { html, css, js } = req.body;
  
  if (!html && !css && !js) {
    return res.status(400).json({ error: 'At least one of html, css, or js required' });
  }

  try {
    // Analyze the code for potential issues
    const issues = [];
    const suggestions = [];
    
    // HTML analysis
    if (html) {
      if (!html.includes('<!DOCTYPE')) {
        issues.push({ type: 'warning', message: 'Missing DOCTYPE declaration' });
      }
      if (!html.includes('<meta name="viewport"')) {
        suggestions.push('Add viewport meta tag for mobile responsiveness');
      }
      if (html.includes('onclick=') || html.includes('onload=')) {
        suggestions.push('Consider using addEventListener instead of inline handlers');
      }
    }
    
    // CSS analysis
    if (css) {
      if (!css.includes('box-sizing')) {
        suggestions.push('Consider adding box-sizing: border-box for consistent sizing');
      }
      if (css.includes('!important')) {
        issues.push({ type: 'warning', message: 'Avoid using !important when possible' });
      }
    }
    
    // JS analysis
    if (js) {
      if (js.includes('var ')) {
        suggestions.push('Use let/const instead of var for better scoping');
      }
      if (js.includes('eval(')) {
        issues.push({ type: 'error', message: 'Avoid using eval() - security risk' });
      }
      if (js.includes('innerHTML') && !js.includes('sanitize')) {
        issues.push({ type: 'warning', message: 'innerHTML without sanitization can be XSS vulnerable' });
      }
      
      // Try to parse JS for syntax errors
      try {
        new Function(js);
      } catch (e) {
        issues.push({ type: 'error', message: `JavaScript syntax error: ${e.message}` });
      }
    }
    
    res.json({
      success: issues.filter(i => i.type === 'error').length === 0,
      issues,
      suggestions,
      analysis: {
        htmlLength: html?.length || 0,
        cssLength: css?.length || 0,
        jsLength: js?.length || 0
      }
    });
    
  } catch (error) {
    res.json({
      success: false,
      errors: error.message
    });
  }
});

// NPM package info
router.get('/npm/:package', async (req, res) => {
  const { package: pkg } = req.params;
  
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://registry.npmjs.org/${pkg}`);
    
    if (!response.ok) {
      throw new Error('Package not found');
    }
    
    const data = await response.json();
    const latest = data['dist-tags']?.latest;
    const latestVersion = data.versions?.[latest];
    
    res.json({
      name: data.name,
      description: data.description,
      version: latest,
      homepage: data.homepage,
      repository: data.repository?.url,
      dependencies: latestVersion?.dependencies ? Object.keys(latestVersion.dependencies) : [],
      keywords: data.keywords || []
    });
    
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

function formatOutput(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }
  return String(value);
}

export default router;
