import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import db from '../../database/index.js';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Get file content
router.get('/:projectId/:fileId', (req, res) => {
  const { projectId, fileId } = req.params;
  
  const project = db.getProject(projectId);
  if (!project || project.user_id !== req.userId) {
    return res.status(404).json({ error: 'Project not found' });
  }
  
  const file = db.getFile(fileId);
  if (!file || file.project_id !== projectId) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.json({ file });
});

// Create/update file
router.post('/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const { path, name, content, mimeType } = req.body;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const fileId = db.saveFile(projectId, {
      path,
      name: name || path.split('/').pop(),
      content,
      mimeType: mimeType || 'text/plain',
      size: Buffer.byteLength(content, 'utf8'),
      isDirectory: false
    });
    
    const file = db.getFile(fileId);
    res.json({ file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file
router.post('/:projectId/upload', upload.single('file'), (req, res) => {
  try {
    const { projectId } = req.params;
    const { path } = req.body;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const isText = req.file.mimetype.startsWith('text/') || 
                   /\.(js|ts|jsx|tsx|json|md|html|css|yml|yaml)$/i.test(req.file.originalname);
    
    const fileId = db.saveFile(projectId, {
      path: path || '/' + req.file.originalname,
      name: req.file.originalname,
      content: isText ? req.file.buffer.toString('utf8') : req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
      size: req.file.size,
      isDirectory: false
    });
    
    const file = db.getFile(fileId);
    res.json({ file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create folder
router.post('/:projectId/folder', (req, res) => {
  try {
    const { projectId } = req.params;
    const { path, name } = req.body;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const fileId = db.saveFile(projectId, {
      path,
      name: name || path.split('/').pop(),
      content: null,
      mimeType: 'inode/directory',
      size: 0,
      isDirectory: true
    });
    
    const file = db.getFile(fileId);
    res.json({ file });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file
router.delete('/:projectId/:fileId', (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    db.deleteFile(fileId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename/move file
router.put('/:projectId/:fileId', (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const { path, name } = req.body;
    
    const project = db.getProject(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const file = db.getFile(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Update file path/name
    db.saveFile(projectId, {
      ...file,
      path: path || file.path,
      name: name || file.name
    });
    
    const updated = db.getFile(fileId);
    res.json({ file: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
