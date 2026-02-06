import { Router } from 'express';
import fetch from 'node-fetch';
import archiver from 'archiver';
import { Readable } from 'stream';
import db from '../../database/index.js';

const router = Router();

// Get deploy tokens
function getDeployToken(userId, platform) {
  const keyRecord = db.getApiKey(userId, platform);
  if (!keyRecord) return process.env[`${platform.toUpperCase()}_TOKEN`];
  return Buffer.from(keyRecord.encrypted_key, 'base64').toString();
}

// Deploy to Vercel
async function deployToVercel(project, files, token) {
  const vercelFiles = files.map(f => ({
    file: f.path.slice(1),
    data: f.content
  }));
  
  const response = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: project.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      files: vercelFiles,
      projectSettings: {
        framework: null
      }
    })
  });
  
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  
  return {
    url: `https://${result.url}`,
    deployId: result.id
  };
}

// Deploy to Netlify
async function deployToNetlify(project, files, token) {
  // Create zip buffer
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks = [];
  
  await new Promise((resolve, reject) => {
    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
    
    for (const file of files) {
      archive.append(file.content, { name: file.path.slice(1) });
    }
    archive.finalize();
  });
  
  const zipBuffer = Buffer.concat(chunks);
  
  // Create site
  const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `nebula-${project.id.slice(0, 8)}`
    })
  });
  
  const site = await siteRes.json();
  if (site.error) throw new Error(site.error);
  
  // Deploy
  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/zip'
    },
    body: zipBuffer
  });
  
  const deploy = await deployRes.json();
  if (deploy.error) throw new Error(deploy.error);
  
  return {
    url: `https://${site.subdomain}.netlify.app`,
    deployId: deploy.id
  };
}

// Deploy to Railway
async function deployToRailway(project, files, token) {
  // Railway uses GraphQL API
  const query = `
    mutation DeployProject($input: DeployInput!) {
      deployProject(input: $input) {
        id
        staticUrl
      }
    }
  `;
  
  const response = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          projectId: project.id,
          files: files.map(f => ({
            path: f.path,
            content: f.content
          }))
        }
      }
    })
  });
  
  const result = await response.json();
  if (result.errors) throw new Error(result.errors[0].message);
  
  return {
    url: result.data.deployProject.staticUrl,
    deployId: result.data.deployProject.id
  };
}

// Deploy project
router.post('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { platform } = req.body;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const token = getDeployToken(req.userId, platform);
    if (!token) {
      return res.status(400).json({ error: `No ${platform} token configured` });
    }
    
    // Get all files with content
    const fileList = db.getProjectFiles(projectId);
    const files = fileList.filter(f => !f.is_directory).map(f => {
      const full = db.getFile(f.id);
      return {
        path: f.path,
        content: full.content
      };
    });
    
    if (files.length === 0) {
      return res.status(400).json({ error: 'Project has no files to deploy' });
    }
    
    // Create deployment record
    const deployment = db.createDeployment(projectId, req.userId, platform);
    
    // Deploy
    let result;
    try {
      if (platform === 'vercel') {
        result = await deployToVercel(project, files, token);
      } else if (platform === 'netlify') {
        result = await deployToNetlify(project, files, token);
      } else if (platform === 'railway') {
        result = await deployToRailway(project, files, token);
      } else {
        throw new Error('Unsupported platform');
      }
      
      db.updateDeployment(deployment.id, {
        status: 'success',
        url: result.url,
        deployId: result.deployId
      });
      
      res.json({
        success: true,
        url: result.url,
        deploymentId: deployment.id
      });
    } catch (deployError) {
      db.updateDeployment(deployment.id, {
        status: 'failed',
        logs: deployError.message
      });
      throw deployError;
    }
  } catch (error) {
    console.error('Deploy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get deployment status
router.get('/status/:deploymentId', (req, res) => {
  const deployment = db.getDeployment(req.params.deploymentId);
  if (!deployment || deployment.user_id !== req.userId) {
    return res.status(404).json({ error: 'Deployment not found' });
  }
  res.json({ deployment });
});

export default router;
