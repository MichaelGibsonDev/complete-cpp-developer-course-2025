import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(REPO_ROOT, 'public')));

const SKIP_DIRS = new Set(['.git', 'node_modules', '_supplemental', 'server', 'public']);

function scanPrograms() {
  const programs = [];

  function scan(dir, depth = 0) {
    if (depth > 7) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasMain = entries.some((e) => e.isFile() && e.name === 'main.cpp');
    if (hasMain) {
      const cppFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.cpp'))
        .map((e) => e.name)
        .sort();
      const hFiles = entries
        .filter((e) => e.isFile() && (e.name.endsWith('.h') || e.name.endsWith('.hpp')))
        .map((e) => e.name)
        .sort();
      const relPath = path.relative(REPO_ROOT, dir);
      const parts = relPath.split(path.sep);
      const section = parts[0];
      const name = parts[parts.length - 1];
      programs.push({ id: relPath, section, name, files: [...cppFiles, ...hFiles] });
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  scan(REPO_ROOT);

  const sections = {};
  for (const p of programs) {
    if (!sections[p.section]) sections[p.section] = [];
    sections[p.section].push(p);
  }

  const sectionNames = Object.keys(sections).sort((a, b) => {
    const na = parseInt(a.match(/\d+/)?.[0] ?? '999');
    const nb = parseInt(b.match(/\d+/)?.[0] ?? '999');
    return na - nb;
  });

  return sectionNames.map((name) => ({
    name,
    programs: sections[name].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// --- Routes ---

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/programs', (_req, res) => {
  res.json({ sections: scanPrograms() });
});

app.get('/api/source', (req, res) => {
  const programPath = req.query.path;
  if (typeof programPath !== 'string') return res.status(400).json({ error: 'Missing path' });
  const absPath = path.resolve(REPO_ROOT, programPath);
  if (!absPath.startsWith(REPO_ROOT + path.sep)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && (e.name.endsWith('.cpp') || e.name.endsWith('.h') || e.name.endsWith('.hpp')))
      .map((e) => ({ name: e.name, content: fs.readFileSync(path.join(absPath, e.name), 'utf-8') }))
      .sort((a, b) => {
        if (a.name === 'main.cpp') return -1;
        if (b.name === 'main.cpp') return 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ files });
  } catch {
    res.status(404).json({ error: 'Program not found' });
  }
});

app.post('/api/run', async (req, res) => {
  const programPath = req.body?.path;
  const input = req.body?.input ?? '';
  if (typeof programPath !== 'string') return res.status(400).json({ error: 'Missing path' });
  const absPath = path.resolve(REPO_ROOT, programPath);
  if (!absPath.startsWith(REPO_ROOT + path.sep)) return res.status(400).json({ error: 'Invalid path' });

  try {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const cppFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith('.cpp'))
      .map((e) => path.join(absPath, e.name));
    if (cppFiles.length === 0) return res.status(400).json({ error: 'No .cpp files found' });

    const binaryPath = path.join(os.tmpdir(), `cpp_runner_${Date.now()}_${Math.random().toString(36).slice(2)}`);

    // Compile
    try {
      await new Promise((resolve, reject) => {
        execFile('g++', ['-o', binaryPath, '-std=c++17', ...cppFiles], { timeout: 30000 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
      });
    } catch (compileErr) {
      try { fs.unlinkSync(binaryPath); } catch {}
      return res.json({
        compileError: compileErr.message || 'Compilation failed',
        stdout: '',
        stderr: '',
        exitCode: -1,
      });
    }

    // Run
    const result = await new Promise((resolve) => {
      const child = spawn(binaryPath, [], { cwd: absPath, timeout: 10000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      child.on('error', (err) => resolve({ stdout, stderr: stderr + err.message, exitCode: -1 }));
      child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
      if (input) child.stdin.write(input);
      child.stdin.end();
    });

    try { fs.unlinkSync(binaryPath); } catch {}

    res.json({ ...result, compileError: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`C++ Runner listening on port ${PORT}`);
});
