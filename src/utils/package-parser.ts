import { readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface ParsedDependency {
  name: string;
  version: string;
  type: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';
  isDev: boolean;
  isOptional: boolean;
  isPeer: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

/**
 * Parses package.json and extracts all dependencies with metadata.
 * 
 * @param projectPath - Path to the project directory containing package.json.
 *                     If not provided, uses current working directory.
 *                     Can be relative or absolute.
 * 
 * @returns Array of parsed dependencies with type information.
 * 
 * @throws Error if package.json is not found or is invalid JSON.
 * 
 * @example
 * const deps = await parseDependencies('/path/to/project');
 * const devDeps = deps.filter(d => d.isDev);
 * 
 * Note: Monorepo support (lerna, npm/yarn workspaces) can be enhanced
 * by recursively parsing workspace package.json files if needed.
 */
export async function parseDependencies(projectPath?: string): Promise<ParsedDependency[]> {
  const basePath = projectPath ? resolve(projectPath) : process.cwd();
  const packageJsonPath = join(basePath, 'package.json');

  let packageJsonContent: string;
  try {
    packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read package.json at ${packageJsonPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(packageJsonContent);
  } catch (error) {
    throw new Error(`Invalid JSON in package.json at ${packageJsonPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  const dependencies: ParsedDependency[] = [];

  // Process regular dependencies
  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      dependencies.push({
        name,
        version,
        type: 'dependency',
        isDev: false,
        isOptional: false,
        isPeer: false,
      });
    }
  }

  // Process devDependencies
  if (packageJson.devDependencies) {
    for (const [name, version] of Object.entries(packageJson.devDependencies)) {
      dependencies.push({
        name,
        version,
        type: 'devDependency',
        isDev: true,
        isOptional: false,
        isPeer: false,
      });
    }
  }

  // Process peerDependencies
  if (packageJson.peerDependencies) {
    for (const [name, version] of Object.entries(packageJson.peerDependencies)) {
      dependencies.push({
        name,
        version,
        type: 'peerDependency',
        isDev: false,
        isOptional: false,
        isPeer: true,
      });
    }
  }

  // Process optionalDependencies
  if (packageJson.optionalDependencies) {
    for (const [name, version] of Object.entries(packageJson.optionalDependencies)) {
      dependencies.push({
        name,
        version,
        type: 'optionalDependency',
        isDev: false,
        isOptional: true,
        isPeer: false,
      });
    }
  }

  return dependencies;
}

/**
 * Validates and normalizes a semantic version string.
 * Handles version ranges: ^, ~, *, exact versions, etc.
 * 
 * @param version - Version string to validate (e.g., "^1.2.3", "~2.0.0", "1.0.0")
 * @returns Object with normalized version and range type.
 */
export function parseVersionFormat(version: string): {
  range: 'exact' | 'caret' | 'tilde' | 'wildcard' | 'range';
  normalized: string;
} {
  if (version.startsWith('^')) {
    return { range: 'caret', normalized: version.substring(1) };
  }
  if (version.startsWith('~')) {
    return { range: 'tilde', normalized: version.substring(1) };
  }
  if (version.includes('*')) {
    return { range: 'wildcard', normalized: version };
  }
  if (version.includes('>') || version.includes('<') || version.includes('=')) {
    return { range: 'range', normalized: version };
  }
  return { range: 'exact', normalized: version };
}
