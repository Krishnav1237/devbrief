import * as fs from 'fs';
import * as path from 'path';
import { loadProjectContext } from '../maintenance/project-context.js';

const SECRET_PATTERNS = [
  { name: 'AWS_ACCESS_KEY_ID', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'GITHUB_TOKEN', regex: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { name: 'OPENAI_API_KEY', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'SLACK_TOKEN', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: 'STRIPE_API_KEY', regex: /\bsk_test_placeholder\b/i },
  { name: 'OPENAI_API_KEY_PLACEHOLDER', regex: /\bsk-proj-placeholder\b/i },
  { name: 'GENERIC_KEY_PLACEHOLDER', regex: /\bYOUR_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\b/i },
  { name: 'GENERIC_TOKEN_PLACEHOLDER', regex: /\bINSERT_[A-Z0-9_]+_HERE\b/i },
  { name: 'GENERIC_SECRET_PLACEHOLDER', regex: /\bTODO_ENTER_[A-Z0-9_]+\b/i },
];

interface StringLiteral {
  value: string;
  raw: string;
  start: number;
  end: number;
}

export function extractStringLiterals(content: string, ext: string): StringLiteral[] {
  const literals: StringLiteral[] = [];
  let i = 0;
  const len = content.length;
  
  const isJS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext);
  const isPy = ext === 'py';
  const isGo = ext === 'go';
  const isRs = ext === 'rs';

  while (i < len) {
    // Check for comments
    if (isJS || isGo || isRs) {
      if (content[i] === '/' && content[i + 1] === '/') {
        while (i < len && content[i] !== '\n') i++;
        continue;
      }
      if (content[i] === '/' && content[i + 1] === '*') {
        i += 2;
        while (i < len && !(content[i] === '*' && content[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
    }
    if (isPy) {
      if (content[i] === '#') {
        while (i < len && content[i] !== '\n') i++;
        continue;
      }
    }

    // Check for string literals
    const char = content[i];
    if (char === '"' || char === "'" || (char === '`' && (isJS || isGo))) {
      let isTriple = false;
      if (isPy && ((char === '"' && content[i+1] === '"' && content[i+2] === '"') || (char === "'" && content[i+1] === "'" && content[i+2] === "'"))) {
        isTriple = true;
      }

      const quote = isTriple ? content.slice(i, i + 3) : char;
      const start = i;
      i += isTriple ? 3 : 1;
      let val = '';
      let escaped = false;

      while (i < len) {
        if (isTriple) {
          if (content.slice(i, i + 3) === quote) {
            i += 3;
            break;
          }
        } else {
          if (content[i] === '\\' && !escaped) {
            escaped = true;
            val += content[i];
            i++;
            continue;
          }
          if (content[i] === quote && !escaped) {
            i++;
            break;
          }
        }
        escaped = false;
        val += content[i];
        i++;
      }
      
      const raw = content.slice(start, i);
      literals.push({
        value: val,
        raw,
        start,
        end: i
      });
      continue;
    }

    i++;
  }
  return literals;
}

export async function cleanSecretsCommand(options?: { path?: string }): Promise<string> {
  const projectPath = options?.path ? path.resolve(options.path) : process.cwd();
  const context = await loadProjectContext(projectPath);

  const scanFiles = [...new Set([...context.sourceFiles, ...context.configFiles, ...context.envFiles])]
    .filter((file) => {
      if (file === 'package-lock.json' || file.endsWith('.lock')) return false;
      if (file.endsWith('.md')) return false;
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
      return true;
    });

  const extractedSecrets = new Map<string, { varName: string; value: string }>();
  const envVarNames = new Set<string>();
  const refactoredFiles: string[] = [];

  for (const file of scanFiles) {
    const absolutePath = path.join(projectPath, file);
    let content = '';
    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const ext = file.split('.').pop()?.toLowerCase() || '';
    const literals = extractStringLiterals(content, ext);
    const replacements: { start: number; end: number; val: string }[] = [];

    for (const literal of literals) {
      for (const pattern of SECRET_PATTERNS) {
        const match = literal.value.match(pattern.regex);
        if (match && match[0] === literal.value) {
          let entry = extractedSecrets.get(literal.value);
          if (!entry) {
            let baseVarName = pattern.name;
            let counter = 2;
            let varName = baseVarName;
            while (envVarNames.has(varName)) {
              varName = `${baseVarName}_${counter}`;
              counter++;
            }
            entry = { varName, value: literal.value };
            extractedSecrets.set(literal.value, entry);
            envVarNames.add(varName);
          }

          let replacement = '';
          if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) {
            replacement = `process.env.${entry.varName}`;
          } else if (ext === 'py') {
            replacement = `os.environ.get("${entry.varName}")`;
          } else if (ext === 'go') {
            replacement = `os.Getenv("${entry.varName}")`;
          } else if (ext === 'rs') {
            replacement = `std::env::var("${entry.varName}").unwrap_or_default()`;
          } else {
            replacement = `process.env.${entry.varName}`;
          }

          replacements.push({
            start: literal.start,
            end: literal.end,
            val: replacement
          });
          break;
        }
      }
    }

    if (replacements.length > 0) {
      replacements.sort((a, b) => b.start - a.start);
      for (const rep of replacements) {
        content = content.slice(0, rep.start) + rep.val + content.slice(rep.end);
      }

      if (ext === 'py' && !content.includes('import os')) {
        content = 'import os\n' + content;
      } else if (ext === 'go' && !content.includes('"os"') && !content.includes('import "os"')) {
        if (content.includes('import (')) {
          content = content.replace('import (', 'import (\n\t"os"');
        } else {
          content = content.replace('package main\n', 'package main\n\nimport "os"\n');
        }
      }

      fs.writeFileSync(absolutePath, content, 'utf-8');
      refactoredFiles.push(file);
    }
  }

  if (extractedSecrets.size === 0) {
    return 'SAFE: No hardcoded secrets or AI placeholders found to refactor.';
  }

  // Update .env and .env.example files
  const envPath = path.join(projectPath, '.env');
  const envExamplePath = path.join(projectPath, '.env.example');

  let envContent = '';
  try {
    envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  } catch {}

  let envExampleContent = '';
  try {
    envExampleContent = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf-8') : '';
  } catch {}

  const envLines = envContent.split(/\r?\n/);
  const envExampleLines = envExampleContent.split(/\r?\n/);

  for (const entry of extractedSecrets.values()) {
    const envHasKey = envLines.some((line) => line.trim().startsWith(`${entry.varName}=`));
    if (!envHasKey) {
      envLines.push(`${entry.varName}=${entry.value}`);
    }

    const exampleHasKey = envExampleLines.some((line) => line.trim().startsWith(`${entry.varName}=`));
    if (!exampleHasKey) {
      envExampleLines.push(`${entry.varName}=`);
    }
  }

  fs.writeFileSync(envPath, envLines.join('\n').trim() + '\n', 'utf-8');
  fs.writeFileSync(envExamplePath, envExampleLines.join('\n').trim() + '\n', 'utf-8');

  // Update .gitignore to ensure .env is ignored
  const gitignorePath = path.join(projectPath, '.gitignore');
  let gitignoreContent = '';
  try {
    gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  } catch {}

  const gitignoreLines = gitignoreContent.split(/\r?\n/);
  const isEnvIgnored = gitignoreLines.some((line) => {
    const trimmed = line.trim();
    return trimmed === '.env' || trimmed === '.env.*' || trimmed.startsWith('.env');
  });

  if (!isEnvIgnored) {
    gitignoreLines.push('.env');
    fs.writeFileSync(gitignorePath, gitignoreLines.join('\n').trim() + '\n', 'utf-8');
  }

  const lines = [
    'SUCCESS: Secrets refactored successfully!',
    '',
    'Refactored files:',
    ...refactoredFiles.map((f) => `  - ${f}`),
    '',
    'Extracted environment variables:',
    ...[...extractedSecrets.values()].map((e) => `  - ${e.varName}`),
    '',
    'Updated configuration files:',
    '  - .env',
    '  - .env.example',
    '  - .gitignore',
  ];

  return lines.join('\n');
}
