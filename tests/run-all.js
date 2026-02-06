// ============================================
// NEBULA AI - Test Suite
// ============================================

import assert from 'assert';

const tests = {
  'Database connection': async () => {
    const db = (await import('../database/index.js')).default;
    db.init();
    assert(db.db, 'Database should be initialized');
  },
  
  'User creation': async () => {
    const db = (await import('../database/index.js')).default;
    const user = await db.createUser({
      email: `test${Date.now()}@test.com`,
      password: 'testpass123',
      name: 'Test User'
    });
    assert(user.id, 'User should have an ID');
    assert(user.email, 'User should have an email');
  },
  
  'Project CRUD': async () => {
    const db = (await import('../database/index.js')).default;
    const user = await db.createUser({
      email: `test${Date.now()}@test.com`,
      password: 'testpass123'
    });
    
    const project = db.createProject(user.id, {
      name: 'Test Project',
      description: 'Test description'
    });
    assert(project.id, 'Project should have an ID');
    
    const updated = db.updateProject(project.id, { name: 'Updated Name' });
    assert.strictEqual(updated.name, 'Updated Name');
    
    db.deleteProject(project.id);
    const deleted = db.getProject(project.id);
    assert(!deleted, 'Project should be deleted');
  },
  
  'File operations': async () => {
    const db = (await import('../database/index.js')).default;
    const user = await db.createUser({
      email: `test${Date.now()}@test.com`,
      password: 'testpass123'
    });
    const project = db.createProject(user.id, { name: 'File Test' });
    
    const fileId = db.saveFile(project.id, {
      path: '/index.html',
      name: 'index.html',
      content: '<html></html>',
      mimeType: 'text/html',
      size: 13
    });
    assert(fileId, 'File should have an ID');
    
    const file = db.getFile(fileId);
    assert.strictEqual(file.content, '<html></html>');
  },
  
  'Config loading': async () => {
    const config = (await import('../config/default.js')).default;
    assert(config.server, 'Config should have server settings');
    assert(config.ai, 'Config should have AI settings');
    assert(config.ai.providers.anthropic, 'Config should have Anthropic provider');
  }
};

async function runTests() {
  console.log('\\n🧪 Running Nebula AI Tests\\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\\n📊 Results: ${passed} passed, ${failed} failed\\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
