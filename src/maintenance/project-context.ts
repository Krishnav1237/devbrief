import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import type { EcosystemName, ProjectContext, ProjectDependency, ProjectProfile } from './types.js';

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'fixtures',
  'vendor',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.java',
  '.php',
  '.rs',
]);

const CONFIG_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'terraform.tf',
  'Chart.yaml',
  'values.yaml',
  '.nvmrc',
  '.node-version',
  'pyproject.toml',
  'requirements.txt',
  'poetry.lock',
  'Pipfile',
  'Gemfile',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'gradle.properties',
  'kustomization.yaml',
]);

function extensionOf(file: string): string {
  const index = file.lastIndexOf('.');
  return index === -1 ? '' : file.slice(index);
}

function walkFiles(basePath: string, currentPath = basePath, output: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return output;
  }

  for (const entry of entries) {
    const absolute = join(currentPath, entry);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) {
        walkFiles(basePath, absolute, output);
      }
      continue;
    }

    if (stats.isFile() && stats.size <= 750_000) {
      output.push(relative(basePath, absolute));
    }
  }

  return output;
}

function parsePackageJson(projectPath: string): ProjectContext['packageJson'] | undefined {
  const packagePath = join(projectPath, 'package.json');
  if (!existsSync(packagePath)) return undefined;

  try {
    return JSON.parse(readFileSync(packagePath, 'utf-8')) as ProjectContext['packageJson'];
  } catch {
    return undefined;
  }
}

function collectDependencies(packageJson: ProjectContext['packageJson']): ProjectDependency[] {
  if (!packageJson) return [];

  const dependencyGroups: Array<[ProjectDependency['type'], Record<string, string> | undefined]> = [
    ['dependency', packageJson.dependencies],
    ['devDependency', packageJson.devDependencies],
    ['peerDependency', packageJson.peerDependencies],
    ['optionalDependency', packageJson.optionalDependencies],
  ];

  return dependencyGroups.flatMap(([type, dependencies]) =>
    Object.entries(dependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      type,
      ecosystem: 'JavaScript/TypeScript',
      isDev: type === 'devDependency',
    })),
  );
}

function parseRequirements(content: string): ProjectDependency[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.split(/[#;]/)[0].trim())
    .filter((line) => line && !line.startsWith('-'))
    .map((line) => {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*([<>=!~]=?.*)?$/);
      return {
        name: match?.[1] ?? line,
        version: match?.[2]?.trim() ?? 'unversioned',
        type: 'requirement',
        ecosystem: 'Python',
        isDev: false,
      } satisfies ProjectDependency;
    });
}

function parseTomlDependencies(content: string, ecosystem: EcosystemName, type: ProjectDependency['type']): ProjectDependency[] {
  const dependencies: ProjectDependency[] = [];
  let inDependencies = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (/^\[.*dependencies.*\]$/.test(line)) {
      inDependencies = true;
      const subDepMatch = line.match(/^\[dependencies\.([A-Za-z0-9_.-]+)\]$/);
      if (subDepMatch) {
        dependencies.push({
          name: subDepMatch[1],
          version: 'managed',
          type,
          ecosystem,
          isDev: false,
        });
      }
      continue;
    }

    if (/^\[.+\]$/.test(line)) {
      inDependencies = false;
      continue;
    }

    if (inDependencies) {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (match) {
        let versionVal = match[2].trim();
        if (versionVal.startsWith('{')) {
          const versionMatch = versionVal.match(/version\s*=\s*["']([^"']+)["']/);
          versionVal = versionMatch ? versionMatch[1] : 'managed';
        } else {
          versionVal = versionVal.replace(/^["']|["']$/g, '');
        }

        dependencies.push({
          name: match[1],
          version: versionVal,
          type,
          ecosystem,
          isDev: false,
        });
      }
    }
  }

  return dependencies;
}

function parsePyprojectDependencies(content: string): ProjectDependency[] {
  const dependencies: ProjectDependency[] = [];
  const arrayMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return dependencies;

  for (const match of arrayMatch[1].matchAll(/["']([^"'[<>=!~\s]+)([^"']*)["']/g)) {
    dependencies.push({
      name: match[1],
      version: match[2]?.trim() || 'unversioned',
      type: 'requirement',
      ecosystem: 'Python',
      isDev: false,
    });
  }

  return dependencies;
}

function parseGoMod(content: string): ProjectDependency[] {
  const dependencies: ProjectDependency[] = [];
  const lines = content.split(/\r?\n/);
  let inRequireBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('//')) {
      continue;
    }
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }

    const requireLine = line.startsWith('require ') ? line.replace(/^require\s+/, '') : inRequireBlock ? line : '';
    const match = requireLine.match(/^([^\s]+)\s+([^\s]+)/);
    if (match) {
      dependencies.push({
        name: match[1],
        version: match[2],
        type: 'module',
        ecosystem: 'Go',
        isDev: false,
      });
    }
  }

  return dependencies;
}

function parseJvmDependencies(content: string, type: 'maven' | 'gradle'): ProjectDependency[] {
  const dependencies: ProjectDependency[] = [];

  if (type === 'maven') {
    const matches = content.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g);
    for (const match of matches) {
      dependencies.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3] ?? 'managed',
        type: 'maven',
        ecosystem: 'Java/JVM',
        isDev: false,
      });
    }
  } else {
    const matches = content.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*['"]([^:'"]+):([^:'"]+):?([^'"]*)['"]/g);
    for (const match of matches) {
      dependencies.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3] || 'managed',
        type: 'gradle',
        ecosystem: 'Java/JVM',
        isDev: rawGradleScopeIsDev(match[0]),
      });
    }
  }

  return dependencies;
}

function rawGradleScopeIsDev(scopeText: string): boolean {
  return scopeText.startsWith('test');
}

function collectEcosystemDependencies(projectPath: string, files: string[], packageJson: ProjectContext['packageJson']): ProjectDependency[] {
  const dependencies = collectDependencies(packageJson);

  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(join(projectPath, file), 'utf-8');
    } catch {
      continue;
    }

    const name = file.split('/').pop() ?? file;
    if (name === 'package.json' && file !== 'package.json') {
      try {
        dependencies.push(...collectDependencies(JSON.parse(content) as ProjectContext['packageJson']));
      } catch {
        continue;
      }
    }
    if (name === 'requirements.txt') dependencies.push(...parseRequirements(content));
    if (name === 'pyproject.toml') {
      dependencies.push(...parseTomlDependencies(content, 'Python', 'requirement'));
      dependencies.push(...parsePyprojectDependencies(content));
    }
    if (name === 'Cargo.toml') dependencies.push(...parseTomlDependencies(content, 'Rust', 'crate'));
    if (name === 'go.mod') dependencies.push(...parseGoMod(content));
    if (name === 'pom.xml') dependencies.push(...parseJvmDependencies(content, 'maven'));
    if (name === 'build.gradle' || name === 'build.gradle.kts') dependencies.push(...parseJvmDependencies(content, 'gradle'));
  }

  return dependencies;
}

function parsePackageLock(projectPath: string): Map<string, string> {
  const lockPath = join(projectPath, 'package-lock.json');
  const packages = new Map<string, string>();

  if (!existsSync(lockPath)) return packages;

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };

    for (const [key, value] of Object.entries(lock.packages ?? {})) {
      if (!key.startsWith('node_modules/') || !value.version) continue;
      packages.set(key.replace(/^node_modules\//, ''), value.version);
    }

    for (const [name, value] of Object.entries(lock.dependencies ?? {})) {
      if (value.version && !packages.has(name)) {
        packages.set(name, value.version);
      }
    }
  } catch {
    return packages;
  }

  return packages;
}

function isWorkflowFile(file: string): boolean {
  return file.startsWith('.github/workflows/') && (file.endsWith('.yml') || file.endsWith('.yaml'));
}

function isDockerFile(file: string): boolean {
  const name = file.split('/').pop() ?? file;
  return name === 'Dockerfile' || name.startsWith('Dockerfile.') || /compose\.ya?ml$/.test(file);
}

function isEnvFile(file: string): boolean {
  const name = file.split('/').pop() ?? file;
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env');
}

function isConfigFile(file: string): boolean {
  const name = file.split('/').pop() ?? file;
  return CONFIG_NAMES.has(name) || isWorkflowFile(file) || isDockerFile(file) || isKubernetesFile(file) || file.endsWith('.tf');
}

function isKubernetesFile(file: string): boolean {
  if (!(file.endsWith('.yml') || file.endsWith('.yaml'))) return false;
  const name = file.split('/').pop() ?? file;
  return name.includes('k8s') || name.includes('kubernetes') || name === 'deployment.yaml' || name === 'service.yaml' || name === 'ingress.yaml';
}

function hasFile(files: string[], names: string[]): boolean {
  return files.some((file) => names.includes(file) || names.includes(file.split('/').pop() ?? file));
}

function detectProjectKinds(packageJson: ProjectContext['packageJson'], files: string[], dependencies: ProjectDependency[]): string[] {
  const depNames = new Set(dependencies.map((dep) => dep.name));
  const kinds = new Set<string>();

  if (depNames.has('next')) kinds.add('Next.js');
  if (depNames.has('vite')) kinds.add('Vite');
  if (depNames.has('react')) kinds.add('React');
  if (depNames.has('express')) kinds.add('Express');
  if (depNames.has('@nestjs/core')) kinds.add('NestJS');
  if (depNames.has('@remix-run/node') || depNames.has('@remix-run/react')) kinds.add('Remix');
  if (depNames.has('astro')) kinds.add('Astro');
  if (depNames.has('svelte')) kinds.add('Svelte');
  if (depNames.has('vue')) kinds.add('Vue');
  if (packageJson && kinds.size === 0) kinds.add('Node package');
  if (hasFile(files, ['pyproject.toml', 'requirements.txt', 'Pipfile'])) kinds.add('Python project');
  if (hasFile(files, ['Cargo.toml'])) kinds.add('Rust crate');
  if (hasFile(files, ['go.mod'])) kinds.add('Go module');
  if (hasFile(files, ['pom.xml', 'build.gradle', 'build.gradle.kts'])) kinds.add('Java/JVM project');
  if (files.some(isDockerFile)) kinds.add('Containerized app');
  if (files.some(isWorkflowFile)) kinds.add('GitHub Actions project');

  return [...kinds];
}

function detectProjectRoots(files: string[]): string[] {
  const roots = new Set<string>();

  for (const file of files) {
    const name = file.split('/').pop() ?? file;
    if (![
      'package.json',
      'pyproject.toml',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'Dockerfile',
    ].includes(name)) {
      continue;
    }

    const dir = file.includes('/') ? file.split('/').slice(0, -1).join('/') : '.';
    roots.add(dir);
  }

  return [...roots].sort();
}

function detectProfile(files: string[], packageJson: ProjectContext['packageJson'], dependencies: ProjectDependency[]): ProjectProfile {
  const ecosystems = new Set<EcosystemName>();
  const packageManagers = new Set<string>();
  const runtimeIndicators = new Set<string>();
  const infraSignals = new Set<string>();
  const securitySignals = new Set<string>();
  const serviceSignals = new Set<string>();
  const depNames = new Set(dependencies.map((dep) => dep.name));

  if (packageJson) ecosystems.add('JavaScript/TypeScript');
  if (packageJson?.engines?.node) runtimeIndicators.add('package.json');
  if (hasFile(files, ['package-lock.json'])) packageManagers.add('npm');
  if (hasFile(files, ['pnpm-lock.yaml'])) packageManagers.add('pnpm');
  if (hasFile(files, ['yarn.lock'])) packageManagers.add('yarn');
  if (packageJson && packageManagers.size === 0) packageManagers.add('npm-compatible');

  if (hasFile(files, ['pyproject.toml', 'requirements.txt', 'poetry.lock', 'Pipfile', '.python-version'])) ecosystems.add('Python');
  if (hasFile(files, ['poetry.lock'])) packageManagers.add('Poetry');
  if (hasFile(files, ['Pipfile'])) packageManagers.add('Pipenv');
  if (hasFile(files, ['requirements.txt']) || hasFile(files, ['pyproject.toml'])) packageManagers.add('pip-compatible');

  if (hasFile(files, ['Cargo.toml', 'Cargo.lock'])) {
    ecosystems.add('Rust');
    packageManagers.add('Cargo');
  }
  if (hasFile(files, ['go.mod', 'go.sum'])) {
    ecosystems.add('Go');
    packageManagers.add('Go modules');
  }
  if (hasFile(files, ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.properties'])) {
    ecosystems.add('Java/JVM');
    if (hasFile(files, ['pom.xml'])) packageManagers.add('Maven');
    if (hasFile(files, ['build.gradle', 'build.gradle.kts'])) packageManagers.add('Gradle');
  }
  if (files.some(isDockerFile) || files.some(isWorkflowFile) || files.some((file) => file.endsWith('.tf') || isKubernetesFile(file))) {
    ecosystems.add('Container/Infra');
  }

  for (const file of files) {
    if (['.nvmrc', '.node-version', '.python-version', 'runtime.txt', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts'].includes(file.split('/').pop() ?? file) || isDockerFile(file)) {
      runtimeIndicators.add(file);
    }
    if (isDockerFile(file) || isWorkflowFile(file) || file.endsWith('.tf') || isKubernetesFile(file)) {
      infraSignals.add(file);
    }
    if (isEnvFile(file) || /config/i.test(file)) {
      securitySignals.add(file);
    }
  }

  for (const dep of ['openai', '@anthropic-ai/sdk', 'stripe', '@clerk/nextjs', '@supabase/supabase-js', 'resend', 'twilio']) {
    if (depNames.has(dep)) serviceSignals.add(dep);
  }

  if (ecosystems.size === 0) ecosystems.add('Unknown');

  return {
    ecosystems: [...ecosystems],
    packageManagers: [...packageManagers],
    projectKinds: detectProjectKinds(packageJson, files, dependencies),
    projectRoots: detectProjectRoots(files),
    runtimeIndicators: [...runtimeIndicators],
    infraSignals: [...infraSignals],
    securitySignals: [...securitySignals],
    serviceSignals: [...serviceSignals],
  };
}

function buildFingerprint(projectPath: string, files: string[]): string {
  return files.map((file) => {
    try {
      const stats = statSync(join(projectPath, file));
      return `${file}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
    } catch {
      return `${file}:missing`;
    }
  }).join('|');
}

export function readProjectFile(context: ProjectContext, file: string): string {
  return readFileSync(join(context.projectPath, file), 'utf-8');
}

export async function loadProjectContext(projectPath?: string): Promise<ProjectContext> {
  const resolved = resolve(projectPath ?? process.cwd());
  const files = walkFiles(resolved).sort();
  const packageJson = parsePackageJson(resolved);
  const dependencies = collectEcosystemDependencies(resolved, files, packageJson);
  const profile = detectProfile(files, packageJson, dependencies);

  return {
    projectPath: resolved,
    packageJson,
    dependencies,
    lockPackages: parsePackageLock(resolved),
    profile,
    fingerprint: buildFingerprint(resolved, files),
    files,
    sourceFiles: files.filter((file) => SOURCE_EXTENSIONS.has(extensionOf(file))),
    configFiles: files.filter(isConfigFile),
    dockerFiles: files.filter(isDockerFile),
    workflowFiles: files.filter(isWorkflowFile),
    envFiles: files.filter(isEnvFile),
  };
}
