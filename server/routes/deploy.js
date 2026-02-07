import { Router } from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = Router();

// Deploy to Netlify
router.post('/netlify', async (req, res) => {
  try {
    const { files } = req.body;
    const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
    
    if (!NETLIFY_TOKEN) {
      return res.json({ error: 'Netlify token not configured' });
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
    if (!site.id) throw new Error('Failed to create site');

    // Create deploy with files
    const fileDigest = {};
    const fileContents = {};
    
    for (const file of files) {
      const path = file.path.startsWith('/') ? file.path : '/' + file.path;
      const hash = crypto.createHash('sha1').update(file.content).digest('hex');
      fileDigest[path] = hash;
      fileContents[hash] = file.content;
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

    res.json({
      success: true,
      url: deploy.ssl_url || deploy.url || `https://${site.subdomain}.netlify.app`,
      siteId: site.id,
      deployId: deploy.id
    });

  } catch (err) {
    res.json({ error: err.message });
  }
});

// Deploy to Vercel
router.post('/vercel', async (req, res) => {
  try {
    const { files } = req.body;
    const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
    
    if (!VERCEL_TOKEN) {
      return res.json({ error: 'Vercel token not configured' });
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
        projectSettings: {
          framework: null
        }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Deploy failed');
    }

    res.json({
      success: true,
      url: `https://${data.url}`,
      deploymentId: data.id
    });

  } catch (err) {
    res.json({ error: err.message });
  }
});

export default router;
