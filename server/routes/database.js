import { Router } from 'express';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const router = Router();
const DB_DIR = './data/user_dbs';
const databases = new Map();
let SQL = null;

// Initialize sql.js
async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

async function getDb(sessionId) {
  if (!databases.has(sessionId)) {
    await initSQL();
    const dbPath = path.join(DB_DIR, `${sessionId}.db`);
    let db;
    
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }
    
    databases.set(sessionId, db);
  }
  return databases.get(sessionId);
}

function saveDb(sessionId) {
  const db = databases.get(sessionId);
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(path.join(DB_DIR, `${sessionId}.db`), buffer);
  }
}

// Execute SQL query
router.post('/query', async (req, res) => {
  const { sessionId = 'default', sql, params = [] } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL query required' });
  }

  try {
    const db = await getDb(sessionId);
    const trimmedSql = sql.trim().toUpperCase();
    
    if (trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('PRAGMA')) {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      
      res.json({ success: true, rows, rowCount: rows.length });
    } else {
      db.run(sql, params);
      saveDb(sessionId);
      res.json({ success: true, changes: db.getRowsModified() });
    }
  } catch (error) {
    console.error('SQL error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get database schema
router.get('/schema', async (req, res) => {
  const { sessionId = 'default' } = req.query;
  
  try {
    const db = await getDb(sessionId);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    
    const schema = {};
    
    if (tables.length && tables[0].values) {
      for (const [tableName] of tables[0].values) {
        const columns = db.exec(`PRAGMA table_info(${tableName})`);
        const count = db.exec(`SELECT COUNT(*) as count FROM ${tableName}`);
        
        schema[tableName] = {
          columns: columns[0]?.values?.map(col => ({
            name: col[1],
            type: col[2],
            nullable: !col[3],
            primaryKey: col[5] === 1
          })) || [],
          rowCount: count[0]?.values?.[0]?.[0] || 0
        };
      }
    }
    
    res.json({ success: true, schema });
  } catch (error) {
    console.error('Schema error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export database as SQL
router.get('/export', async (req, res) => {
  const { sessionId = 'default' } = req.query;
  
  try {
    const db = await getDb(sessionId);
    let sql = '';
    
    const tables = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    
    if (tables.length && tables[0].values) {
      for (const [name, createSql] of tables[0].values) {
        sql += `-- Table: ${name}\n${createSql};\n\n`;
        
        const rows = db.exec(`SELECT * FROM ${name}`);
        if (rows.length && rows[0].values) {
          const columns = rows[0].columns;
          for (const row of rows[0].values) {
            const values = row.map(v => {
              if (v === null) return 'NULL';
              if (typeof v === 'number') return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            }).join(', ');
            sql += `INSERT INTO ${name} (${columns.join(', ')}) VALUES (${values});\n`;
          }
          sql += '\n';
        }
      }
    }
    
    res.json({ success: true, sql });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import SQL dump
router.post('/import', async (req, res) => {
  const { sessionId = 'default', sql } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL dump required' });
  }

  try {
    const db = await getDb(sessionId);
    db.exec(sql);
    saveDb(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Import error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Reset database
router.post('/reset', async (req, res) => {
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
