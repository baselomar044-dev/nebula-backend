import { Router } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const router = Router();

// Store databases per session (in-memory for demo, file-based for persistence)
const databases = new Map();
const DB_DIR = './data/user_dbs';

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function getDb(sessionId) {
  if (!databases.has(sessionId)) {
    const dbPath = path.join(DB_DIR, `${sessionId}.db`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    databases.set(sessionId, db);
  }
  return databases.get(sessionId);
}

// Execute SQL query
router.post('/query', (req, res) => {
  const { sessionId = 'default', sql, params = [] } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL query required' });
  }

  try {
    const db = getDb(sessionId);
    const trimmedSql = sql.trim().toUpperCase();
    
    // Determine if it's a read or write operation
    if (trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('PRAGMA') || trimmedSql.startsWith('EXPLAIN')) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      res.json({ success: true, rows, rowCount: rows.length });
    } else {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      res.json({ 
        success: true, 
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      });
    }
  } catch (error) {
    console.error('SQL error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get database schema
router.get('/schema', (req, res) => {
  const { sessionId = 'default' } = req.query;
  
  try {
    const db = getDb(sessionId);
    
    // Get all tables
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    const schema = {};
    
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
      const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
      
      schema[table.name] = {
        columns: columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: !c.notnull,
          primaryKey: c.pk === 1,
          defaultValue: c.dflt_value
        })),
        rowCount: rowCount.count
      };
    }
    
    res.json({ success: true, schema });
  } catch (error) {
    console.error('Schema error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create table with smart schema inference
router.post('/create-table', (req, res) => {
  const { sessionId = 'default', tableName, columns } = req.body;
  
  if (!tableName || !columns || !Array.isArray(columns)) {
    return res.status(400).json({ error: 'Table name and columns required' });
  }

  try {
    const db = getDb(sessionId);
    
    const columnDefs = columns.map(col => {
      let def = `${col.name} ${col.type || 'TEXT'}`;
      if (col.primaryKey) def += ' PRIMARY KEY';
      if (col.autoIncrement) def += ' AUTOINCREMENT';
      if (col.notNull) def += ' NOT NULL';
      if (col.unique) def += ' UNIQUE';
      if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
      return def;
    }).join(', ');
    
    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`;
    db.exec(sql);
    
    res.json({ success: true, sql });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Insert data (batch support)
router.post('/insert', (req, res) => {
  const { sessionId = 'default', tableName, rows } = req.body;
  
  if (!tableName || !rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Table name and rows required' });
  }

  try {
    const db = getDb(sessionId);
    
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    
    const stmt = db.prepare(sql);
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        stmt.run(...columns.map(c => row[c]));
      }
    });
    
    insertMany(rows);
    
    res.json({ success: true, inserted: rows.length });
  } catch (error) {
    console.error('Insert error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Export database as SQL
router.get('/export', (req, res) => {
  const { sessionId = 'default' } = req.query;
  
  try {
    const db = getDb(sessionId);
    let sql = '';
    
    // Get all tables
    const tables = db.prepare(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    
    for (const table of tables) {
      sql += `-- Table: ${table.name}\n`;
      sql += `${table.sql};\n\n`;
      
      // Export data
      const rows = db.prepare(`SELECT * FROM ${table.name}`).all();
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        for (const row of rows) {
          const values = columns.map(c => {
            const val = row[c];
            if (val === null) return 'NULL';
            if (typeof val === 'number') return val;
            return `'${String(val).replace(/'/g, "''")}'`;
          }).join(', ');
          sql += `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${values});\n`;
        }
        sql += '\n';
      }
    }
    
    res.json({ success: true, sql });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import SQL dump
router.post('/import', (req, res) => {
  const { sessionId = 'default', sql } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL dump required' });
  }

  try {
    const db = getDb(sessionId);
    db.exec(sql);
    res.json({ success: true });
  } catch (error) {
    console.error('Import error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Drop table
router.delete('/table/:tableName', (req, res) => {
  const { sessionId = 'default' } = req.query;
  const { tableName } = req.params;
  
  try {
    const db = getDb(sessionId);
    db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Drop table error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Reset database
router.post('/reset', (req, res) => {
  const { sessionId = 'default' } = req.body;
  
  try {
    if (databases.has(sessionId)) {
      databases.get(sessionId).close();
      databases.delete(sessionId);
    }
    
    const dbPath = path.join(DB_DIR, `${sessionId}.db`);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
