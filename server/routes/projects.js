import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import db from '../../database/index.js';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// List projects
router.get('/', (req, res) => {
  const projects = db.getUserProjects(req.userId);
  res.json({ projects });
});

// Create project
router.post('/', (req, res) => {
  try {
    const project = db.createProject(req.userId, req.body);
    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project
router.get('/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project || project.user_id !== req.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const files = db.getProjectFiles(project.id);
  res.json({ project, files });
});

// Update project
router.put('/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project || project.user_id !== req.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const updated = db.updateProject(req.params.id, req.body);
  res.json({ project: updated });
});

// Delete project
router.delete('/:id', (req, res) => {
  const project = db.getProject(req.params.id);
  if (!project || project.user_id !== req.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  db.deleteProject(req.params.id);
  res.json({ success: true });
});

// Import project (zip upload)
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const projectName = req.body.name || 'Imported Project';
    const project = db.createProject(req.userId, { name: projectName });
    
    // Process zip file
    const directory = await unzipper.Open.buffer(req.file.buffer);
    
    for (const file of directory.files) {
      if (file.type === 'Directory') continue;
      
      const content = await file.buffer();
      const path = file.path.replace(/^[^/]+\//, ''); // Remove root folder
      const name = path.split('/').pop();
      
      if (name.startsWith('.') && name !== '.env.example') continue;
      
      const isText = /\.(js|ts|jsx|tsx|html|css|json|md|txt|yml|yaml|env|gitignore)$/i.test(name);
      
      db.saveFile(project.id, {
        path: '/' + path,
        name,
        content: isText ? content.toString('utf8') : content.toString('base64'),
        mimeType: isText ? 'text/plain' : 'application/octet-stream',
        size: content.length,
        isDirectory: false
      });
    }
    
    const files = db.getProjectFiles(project.id);
    res.json({ project, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export project (download as zip)
router.get('/:id/export', async (req, res) => {
  try {
    const project = db.getProject(req.params.id);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const files = db.getProjectFiles(project.id);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name}.zip"`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    for (const file of files) {
      if (!file.is_directory) {
        const fullFile = db.getFile(file.id);
        const content = fullFile.mime_type === 'text/plain' 
          ? fullFile.content 
          : Buffer.from(fullFile.content, 'base64');
        archive.append(content, { name: file.path.slice(1) });
      }
    }
    
    archive.finalize();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project conversations
router.get('/:id/conversations', (req, res) => {
  const conversations = db.getProjectConversations(req.params.id);
  res.json({ conversations });
});

// Get project deployments
router.get('/:id/deployments', (req, res) => {
  const deployments = db.getProjectDeployments(req.params.id);
  res.json({ deployments });
});

export default router;
