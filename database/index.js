import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class NebulaDB {
  constructor() {
    const dbDir = join(__dirname);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    
    this.db = new Database(join(dbDir, 'nebula.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    this.db.exec(schema);
    this.initialized = true;
    console.log('✅ Database initialized');
  }

  // ============ USERS ============
  async createUser({ email, password, name }) {
    const id = uuid();
    const hash = await bcrypt.hash(password, 12);
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, name)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, email, hash, name);
    return this.getUserById(id);
  }

  getUserById(id) {
    return this.db.prepare('SELECT id, email, name, avatar_url, language, theme, created_at, role FROM users WHERE id = ?').get(id);
  }

  getUserByEmail(email) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }

  async validatePassword(email, password) {
    const user = this.getUserByEmail(email);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password_hash);
    return valid ? this.getUserById(user.id) : null;
  }

  updateUser(id, updates) {
    const allowed = ['name', 'avatar_url', 'language', 'theme'];
    const fields = Object.keys(updates).filter(k => allowed.includes(k));
    if (!fields.length) return this.getUserById(id);
    
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    this.db.prepare(`UPDATE users SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    return this.getUserById(id);
  }

  // ============ API KEYS ============
  saveApiKey(userId, provider, encryptedKey) {
    const existing = this.db.prepare('SELECT id FROM api_keys WHERE user_id = ? AND provider = ?').get(userId, provider);
    if (existing) {
      this.db.prepare('UPDATE api_keys SET encrypted_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(encryptedKey, existing.id);
      return existing.id;
    }
    const id = uuid();
    this.db.prepare('INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)').run(id, userId, provider, encryptedKey);
    return id;
  }

  getApiKey(userId, provider) {
    return this.db.prepare('SELECT encrypted_key FROM api_keys WHERE user_id = ? AND provider = ? AND is_active = 1').get(userId, provider);
  }

  getApiKeys(userId) {
    return this.db.prepare('SELECT provider, is_active, created_at, last_used FROM api_keys WHERE user_id = ?').all(userId);
  }

  // ============ PROJECTS ============
  createProject(userId, { name, description, framework, language }) {
    const id = uuid();
    this.db.prepare(`
      INSERT INTO projects (id, user_id, name, description, framework, language)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, name, description, framework, language);
    return this.getProject(id);
  }

  getProject(id) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }

  getUserProjects(userId) {
    return this.db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  }

  updateProject(id, updates) {
    const allowed = ['name', 'description', 'status', 'framework', 'language', 'settings'];
    const fields = Object.keys(updates).filter(k => allowed.includes(k));
    if (!fields.length) return this.getProject(id);
    
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => typeof updates[f] === 'object' ? JSON.stringify(updates[f]) : updates[f]);
    this.db.prepare(`UPDATE projects SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    return this.getProject(id);
  }

  deleteProject(id) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ============ FILES ============
  saveFile(projectId, { path, name, content, mimeType, size, isDirectory, parentId }) {
    const existing = this.db.prepare('SELECT id FROM project_files WHERE project_id = ? AND path = ?').get(projectId, path);
    if (existing) {
      this.db.prepare(`
        UPDATE project_files SET content = ?, mime_type = ?, size = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(content, mimeType, size, existing.id);
      return existing.id;
    }
    const id = uuid();
    this.db.prepare(`
      INSERT INTO project_files (id, project_id, path, name, content, mime_type, size, is_directory, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, path, name, content, mimeType, size, isDirectory ? 1 : 0, parentId);
    return id;
  }

  getFile(id) {
    return this.db.prepare('SELECT * FROM project_files WHERE id = ?').get(id);
  }

  getFileByPath(projectId, path) {
    return this.db.prepare('SELECT * FROM project_files WHERE project_id = ? AND path = ?').get(projectId, path);
  }

  getProjectFiles(projectId) {
    return this.db.prepare('SELECT id, path, name, mime_type, size, is_directory, parent_id, updated_at FROM project_files WHERE project_id = ? ORDER BY is_directory DESC, name ASC').all(projectId);
  }

  deleteFile(id) {
    this.db.prepare('DELETE FROM project_files WHERE id = ? OR parent_id = ?').run(id, id);
  }

  // ============ CONVERSATIONS ============
  createConversation(projectId, userId, title) {
    const id = uuid();
    this.db.prepare('INSERT INTO conversations (id, project_id, user_id, title) VALUES (?, ?, ?, ?)').run(id, projectId, userId, title);
    return this.getConversation(id);
  }

  getConversation(id) {
    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }

  getProjectConversations(projectId) {
    return this.db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC').all(projectId);
  }

  // ============ MESSAGES ============
  addMessage(conversationId, { role, content, model, tokensInput, tokensOutput, cost, filesAttached }) {
    const id = uuid();
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, model, tokens_input, tokens_output, cost, files_attached)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, role, content, model, tokensInput || 0, tokensOutput || 0, cost || 0, filesAttached ? JSON.stringify(filesAttached) : null);
    
    // Update conversation totals
    this.db.prepare(`
      UPDATE conversations SET 
        total_tokens = total_tokens + ? + ?,
        total_cost = total_cost + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tokensInput || 0, tokensOutput || 0, cost || 0, conversationId);
    
    return this.getMessage(id);
  }

  getMessage(id) {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  }

  getConversationMessages(conversationId) {
    return this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId);
  }

  // ============ DEPLOYMENTS ============
  createDeployment(projectId, userId, platform) {
    const id = uuid();
    this.db.prepare('INSERT INTO deployments (id, project_id, user_id, platform) VALUES (?, ?, ?, ?)').run(id, projectId, userId, platform);
    return this.getDeployment(id);
  }

  getDeployment(id) {
    return this.db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  }

  updateDeployment(id, { status, url, deployId, logs }) {
    const updates = [];
    const values = [];
    if (status) { updates.push('status = ?'); values.push(status); }
    if (url) { updates.push('url = ?'); values.push(url); }
    if (deployId) { updates.push('deploy_id = ?'); values.push(deployId); }
    if (logs) { updates.push('logs = ?'); values.push(logs); }
    if (status === 'success' || status === 'failed') {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }
    if (updates.length) {
      this.db.prepare(`UPDATE deployments SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
    }
    return this.getDeployment(id);
  }

  getProjectDeployments(projectId) {
    return this.db.prepare('SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  }

  // ============ USAGE LOGS ============
  logUsage(userId, action, details, tokensUsed, cost) {
    const id = uuid();
    this.db.prepare(`
      INSERT INTO usage_logs (id, user_id, action, details, tokens_used, cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, action, JSON.stringify(details), tokensUsed, cost);
  }

  getUserUsage(userId, days = 30) {
    return this.db.prepare(`
      SELECT action, SUM(tokens_used) as total_tokens, SUM(cost) as total_cost, COUNT(*) as count
      FROM usage_logs 
      WHERE user_id = ? AND created_at > datetime('now', '-' || ? || ' days')
      GROUP BY action
    `).all(userId, days);
  }

  // ============ SESSIONS ============
  createSession(userId, token, expiresAt, ipAddress, userAgent) {
    const id = uuid();
    this.db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, token, expiresAt, ipAddress, userAgent);
    return id;
  }

  getSession(token) {
    return this.db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP').get(token);
  }

  deleteSession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  cleanExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP').run();
  }
}

export default new NebulaDB();
