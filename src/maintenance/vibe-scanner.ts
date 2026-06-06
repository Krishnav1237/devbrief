import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

// Standard built-in modules to ignore in phantom checks
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const PYTHON_BUILTINS = new Set([
  'abc', 'argparse', 'ast', 'asyncio', 'base64', 'collections', 'copy', 'csv', 'datetime',
  'enum', 'functools', 'hashlib', 'hmac', 'importlib', 'io', 'itertools', 'json', 'logging',
  'math', 'multiprocessing', 'os', 'pathlib', 'random', 're', 'select', 'shutil', 'socket',
  'ssl', 'string', 'subprocess', 'sys', 'tempfile', 'threading', 'time', 'traceback', 'types',
  'typing', 'unittest', 'urllib', 'uuid', 'weakref', 'xml', 'zipfile',
]);

const RUST_BUILTINS = new Set(['std', 'core', 'alloc', 'lazy_static', 'serde']);

// Common JS dev tools/configs that are declared but not directly imported in source files
const IGNORE_UNUSED_DEPS = new Set([
  'typescript', 'tsx', 'ts-node', 'vitest', 'jest', 'eslint', 'prettier', 'nodemon',
  'rimraf', 'concurrently', 'cross-env', 'dotenv', 'husky', 'lint-staged', 'webpack',
  'rollup', 'vite', 'gulp', 'grunt', 'cargo', 'go',
]);

function createVibeFinding(
  id: string,
  category: MaintenanceFinding['category'],
  label: MaintenanceFinding['label'],
  title: string,
  summary: string,
  evidence: string,
  files: string[],
  recommendation: MaintenanceFinding['recommendation'],
): MaintenanceFinding {
  return {
    id,
    category,
    label,
    title,
    summary,
    evidence,
    recommendation,
    urgency: label === 'ACTION REQUIRED' ? 9 : label === 'RISKY' ? 7 : 4,
    impact: label === 'ACTION REQUIRED' ? 9 : label === 'RISKY' ? 7 : 4,
    confidence: 9,
    effort: '5 min',
    files,
  };
}

export const vibeSecurityScanner: Scanner = {
  name: 'vibe-security',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    // 1. Load env and env.example keys
    let envKeys = new Set<string>();
    let exampleKeys = new Set<string>();
    let exampleFile = '';
    let envFile = '';

    for (const file of context.envFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      const keys = new Set<string>();
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
        if (match) {
          keys.add(match[1]);
        }
      }

      const name = file.split('/').pop() ?? file;
      if (name.includes('example') || name.includes('sample') || name.includes('template')) {
        exampleKeys = new Set([...exampleKeys, ...keys]);
        exampleFile = file;
      } else {
        envKeys = new Set([...envKeys, ...keys]);
        envFile = file;
      }
    }

    // 2. Find accessed env vars in source code
    const accessedVars = new Map<string, Set<string>>();
    // Combined regex for JS, Python, Go, Rust environment accesses
    const envRegex = /\b(?:process\.env\.([A-Za-z0-9_]+)|process\.env\[['"]([A-Za-z0-9_]+)['"]\]|os\.environ\.get\(['"]([A-Za-z0-9_]+)['"]\)|os\.getenv\(['"]([A-Za-z0-9_]+)['"]\)|os\.environ\[['"]([A-Za-z0-9_]+)['"]\]|os\.Getenv\(['"]([A-Za-z0-9_]+)['"]\)|env::var\(['"]([A-Za-z0-9_]+)['"]\))/g;

    for (const file of context.sourceFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      let match;
      // Reset lastIndex
      envRegex.lastIndex = 0;
      while ((match = envRegex.exec(content)) !== null) {
        // Find the captured variable name
        const varName = match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || match[7];
        if (varName) {
          // Skip standard/common environment variables
          if (['NODE_ENV', 'PORT', 'PATH', 'PWD', 'HOME', 'USER', 'HOSTNAME', 'TZ'].includes(varName)) {
            continue;
          }
          if (!accessedVars.has(varName)) {
            accessedVars.set(varName, new Set());
          }
          accessedVars.get(varName)!.add(file);
        }
      }
    }

    // 3. Cross-reference env variables
    for (const [varName, files] of accessedVars.entries()) {
      const fileList = [...files];

      // Check if missing from .env.example
      if (exampleFile && !exampleKeys.has(varName)) {
        findings.push(createVibeFinding(
          `vibe:env-undocumented:${varName}`,
          'security',
          'REVIEW',
          `Undocumented environment variable: ${varName}`,
          `Variable ${varName} is accessed in code but is missing from ${exampleFile}`,
          `Accessed in: ${fileList.join(', ')}`,
          fileList,
          'remediate'
        ));
      }

      // Check if missing from local .env config
      if (envFile && !envKeys.has(varName) && (exampleKeys.has(varName) || exampleFile === '')) {
        findings.push(createVibeFinding(
          `vibe:env-missing:${varName}`,
          'security',
          'ACTION REQUIRED',
          `Missing local environment configuration: ${varName}`,
          `Variable ${varName} is required by code but is missing from your local ${envFile}`,
          `Accessed in: ${fileList.join(', ')}`,
          [envFile],
          'remediate'
        ));
      }
    }

    return findings;
  },
};

export const vibeDependencyScanner: Scanner = {
  name: 'vibe-dependency',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    const declaredDeps = new Set(context.dependencies.map((d) => d.name));
    const importedDeps = new Map<string, Set<string>>();

    // Standard import regexes for JS, Python, Go, Rust
    const jsImportRegex = /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|import\s*\(?['"]([^'"]+)['"]\)?|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    const pyImportRegex = /(?:^\s*import\s+([A-Za-z0-9_.-]+)|^\s*from\s+([A-Za-z0-9_.-]+)\s+import)/gm;
    const goImportRegex = /import\s+\(?\s*(?:[A-Za-z0-9_.-]+\s+)?['"]([^'"]+)['"]/g;
    const rustImportRegex = /\bextern\s+crate\s+([A-Za-z0-9_]+)|use\s+([A-Za-z0-9_]+)::/g;

    const extractJsBasePackage = (importPath: string): string => {
      if (importPath.startsWith('.') || importPath.startsWith('/')) return '';
      // Support scoped package like @nestjs/core
      const parts = importPath.split('/');
      if (importPath.startsWith('@') && parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
      return parts[0] ?? '';
    };

    for (const file of context.sourceFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      const ext = file.split('.').pop()?.toLowerCase();

      if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext ?? '')) {
        let match;
        jsImportRegex.lastIndex = 0;
        while ((match = jsImportRegex.exec(content)) !== null) {
          const rawPath = match[1] || match[2] || match[3];
          if (rawPath) {
            const basePkg = extractJsBasePackage(rawPath);
            if (basePkg && !NODE_BUILTINS.has(basePkg)) {
              if (!importedDeps.has(basePkg)) importedDeps.set(basePkg, new Set());
              importedDeps.get(basePkg)!.add(file);
            }
          }
        }
      } else if (ext === 'py') {
        let match;
        pyImportRegex.lastIndex = 0;
        while ((match = pyImportRegex.exec(content)) !== null) {
          const rawPath = match[1] || match[2];
          if (rawPath) {
            const basePkg = rawPath.split('.')[0] ?? '';
            if (basePkg && !PYTHON_BUILTINS.has(basePkg)) {
              if (!importedDeps.has(basePkg)) importedDeps.set(basePkg, new Set());
              importedDeps.get(basePkg)!.add(file);
            }
          }
        }
      } else if (ext === 'go') {
        let match;
        goImportRegex.lastIndex = 0;
        while ((match = goImportRegex.exec(content)) !== null) {
          const rawPath = match[1];
          if (rawPath) {
            // Go standard libraries have no dot in their first path segment (e.g. net/http, fmt vs github.com/foo)
            const firstSegment = rawPath.split('/')[0] ?? '';
            if (firstSegment.includes('.')) {
              if (!importedDeps.has(rawPath)) importedDeps.set(rawPath, new Set());
              importedDeps.get(rawPath)!.add(file);
            }
          }
        }
      } else if (ext === 'rs') {
        let match;
        rustImportRegex.lastIndex = 0;
        while ((match = rustImportRegex.exec(content)) !== null) {
          const rawPath = match[1] || match[2];
          if (rawPath && !RUST_BUILTINS.has(rawPath)) {
            if (!importedDeps.has(rawPath)) importedDeps.set(rawPath, new Set());
            importedDeps.get(rawPath)!.add(file);
          }
        }
      }
    }

    // 1. Identify Phantom Dependencies: imported in code, but not in manifests
    for (const [pkgName, files] of importedDeps.entries()) {
      // Exclude type definition packages and ignored names
      if (pkgName.startsWith('@types/')) continue;
      
      // Check if missing from declared manifests
      if (!declaredDeps.has(pkgName)) {
        // Double check for Python/pip package naming mapping issues (e.g. pyyaml imported as yaml)
        if (context.profile.ecosystems.includes('Python')) {
          const hasMapping = [...declaredDeps].some((d) => 
            d.toLowerCase().replace(/[-_]/g, '') === pkgName.toLowerCase().replace(/[-_]/g, '')
          );
          if (hasMapping) continue;
        }

        const fileList = [...files];
        findings.push(createVibeFinding(
          `vibe:phantom-dependency:${pkgName}`,
          'dependency',
          'ACTION REQUIRED',
          `Phantom dependency detected: ${pkgName}`,
          `Package "${pkgName}" is imported in code but not declared in manifests`,
          `Imported in: ${fileList.join(', ')}`,
          fileList,
          'upgrade'
        ));
      }
    }

    // 2. Identify Unused Dependencies: declared in manifests, but never imported in code
    for (const declared of declaredDeps) {
      if (IGNORE_UNUSED_DEPS.has(declared) || declared.startsWith('@types/')) {
        continue;
      }

      // Check if never imported
      let isUsed = importedDeps.has(declared);

      // Handle Python import variations (e.g. pyyaml -> yaml)
      if (!isUsed && context.profile.ecosystems.includes('Python')) {
        isUsed = [...importedDeps.keys()].some((imp) => 
          imp.toLowerCase().replace(/[-_]/g, '') === declared.toLowerCase().replace(/[-_]/g, '')
        );
      }

      if (!isUsed) {
        // Exclude workspace packages
        const dependency = context.dependencies.find((d) => d.name === declared);
        if (dependency?.version.includes('workspace:') || dependency?.version.includes('file:')) {
          continue;
        }

        findings.push(createVibeFinding(
          `vibe:unused-dependency:${declared}`,
          'dependency',
          'REVIEW',
          `Unused dependency detected: ${declared}`,
          `Package "${declared}" is declared in manifests but never imported in code`,
          'safe to remove if not used for tooling or dynamic/peer loading',
          ['package.json'],
          'review'
        ));
      }
    }

    return findings;
  },
};
