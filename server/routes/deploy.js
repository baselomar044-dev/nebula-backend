import { Router } from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = Router();

// Tokens (from env or fallback)
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN || 'nfp_qa6waRyNGqgJwLar8kn31gtkCXDWJNKssssM76ed';
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || 'Jt5ktin1DUkHa4Mi4UeFHRqb';

// Deploy to Netlify
router.post('/netlify', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || files.length === 0) {
      return res.json({ error: 'No files provided' });
    }

    // Create site
    const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    const site = await siteRes.json();
    if (!site.id) {
      return res.json({ error: 'Failed to create site: ' + JSON.stringify(site) });
    }

    // Create file digest
    const fileDigest = {};
    const fileContents = {};
    
    for (const file of files) {
      const path = file.path.startsWith('/') ? file.path : '/' + file.path;
      const content = file.content || '';
      const hash = crypto.createHash('sha1').update(content).digest('hex');
      fileDigest[path] = hash;
      fileContents[hash] = content;
    }

    // Start deploy
    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: fileDigest })
    });
    
    const deploy = await deployRes.json();
    
    // Upload required files
    if (deploy.required && deploy.required.length > 0) {
      for (const hash of deploy.required) {
        if (fileContents[hash]) {
          await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${hash}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${NETLIFY_TOKEN}`,
              'Content-Type': 'application/octet-stream'
            },
            body: fileContents[hash]
          });
        }
      }
    }

    // Wait a moment for deploy to process
    await new Promise(r => setTimeout(r, 2000));

    res.json({
      success: true,
      url: `https://${site.subdomain}.netlify.app`,
      siteId: site.id,
      deployId: deploy.id
    });

  } catch (err) {
    console.error('Netlify deploy error:', err);
    res.json({ error: err.message });
  }
});

// Deploy to Vercel
router.post('/vercel', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || Object.keys(files).length === 0) {
      return res.json({ error: 'No files provided' });
    }

    // Format files for Vercel
    const vercelFiles = Object.entries(files).map(([name, content]) => ({
      file: name,
      data: Buffer.from(content).toString('base64'),
      encoding: 'base64'
    }));

    // Create deployment
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'ai-deploy-' + Date.now(),
        files: vercelFiles,
        projectSettings: { framework: null }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.json({ error: data.error.message || 'Deploy failed' });
    }

    res.json({
      success: true,
      url: `https://${data.url}`,
      deploymentId: data.id
    });

  } catch (err) {
    console.error('Vercel deploy error:', err);
    res.json({ error: err.message });
  }
});

// Status endpoint
router.get('/status', (req, res) => {
  res.json({
    netlify: !!NETLIFY_TOKEN,
    vercel: !!VERCEL_TOKEN
  });
});

export default router;
