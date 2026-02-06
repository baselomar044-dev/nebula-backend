import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Clone/import from GitHub
router.post('/import', async (req, res) => {
  const { url, branch = 'main' } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Repository URL required' });
  }

  try {
    // Parse GitHub URL
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid GitHub URL' });
    }
    
    const [, owner, repoName] = match;
    const repo = repoName.replace('.git', '');
    
    // Fetch repository tree
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { 'User-Agent': 'AI-App' } }
    );
    
    if (!treeResponse.ok) {
      throw new Error('Repository not found or private');
    }
    
    const treeData = await treeResponse.json();
    const files = [];
    
    // Filter for code files only
    const codeExtensions = ['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.py', '.vue', '.svelte'];
    const relevantFiles = treeData.tree.filter(item => 
      item.type === 'blob' && 
      codeExtensions.some(ext => item.path.endsWith(ext)) &&
      !item.path.includes('node_modules') &&
      !item.path.includes('.git')
    ).slice(0, 50); // Max 50 files
    
    // Fetch file contents
    for (const file of relevantFiles) {
      try {
        const contentResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`,
          { headers: { 'User-Agent': 'AI-App' } }
        );
        
        if (contentResponse.ok) {
          const contentData = await contentResponse.json();
          const content = Buffer.from(contentData.content, 'base64').toString('utf-8');
          files.push({
            path: file.path,
            content,
            size: content.length
          });
        }
      } catch (e) {
        console.error(`Failed to fetch ${file.path}:`, e.message);
      }
    }
    
    res.json({
      success: true,
      repo: `${owner}/${repo}`,
      branch,
      files,
      totalFiles: files.length
    });
    
  } catch (error) {
    console.error('Git import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Push to GitHub (requires token)
router.post('/push', async (req, res) => {
  const { token, repo, files, message = 'Update from AI App', branch = 'main' } = req.body;
  
  if (!token || !repo || !files) {
    return res.status(400).json({ error: 'Token, repo, and files required' });
  }

  try {
    const [owner, repoName] = repo.split('/');
    const results = [];
    
    for (const file of files) {
      try {
        // Check if file exists to get SHA
        let sha = null;
        try {
          const existingResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${file.path}?ref=${branch}`,
            { headers: { 'Authorization': `token ${token}`, 'User-Agent': 'AI-App' } }
          );
          if (existingResponse.ok) {
            const existing = await existingResponse.json();
            sha = existing.sha;
          }
        } catch (e) {}
        
        // Push file
        const pushResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${file.path}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'AI-App'
            },
            body: JSON.stringify({
              message: `${message}: ${file.path}`,
              content: Buffer.from(file.content).toString('base64'),
              branch,
              ...(sha ? { sha } : {})
            })
          }
        );
        
        if (pushResponse.ok) {
          results.push({ path: file.path, success: true });
        } else {
          const error = await pushResponse.json();
          results.push({ path: file.path, success: false, error: error.message });
        }
      } catch (e) {
        results.push({ path: file.path, success: false, error: e.message });
      }
    }
    
    res.json({
      success: results.every(r => r.success),
      results,
      repo,
      branch
    });
    
  } catch (error) {
    console.error('Git push error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new repository
router.post('/create-repo', async (req, res) => {
  const { token, name, description = '', isPrivate = false } = req.body;
  
  if (!token || !name) {
    return res.status(400).json({ error: 'Token and name required' });
  }

  try {
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AI-App'
      },
      body: JSON.stringify({
        name,
        description,
        private: isPrivate,
        auto_init: true
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create repository');
    }
    
    const data = await response.json();
    res.json({
      success: true,
      repo: data.full_name,
      url: data.html_url,
      clone_url: data.clone_url
    });
    
  } catch (error) {
    console.error('Create repo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List user repositories
router.get('/repos', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'AI-App'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch repositories');
    }
    
    const repos = await response.json();
    res.json({
      repos: repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        url: r.html_url,
        description: r.description,
        private: r.private,
        updated_at: r.updated_at
      }))
    });
    
  } catch (error) {
    console.error('List repos error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
