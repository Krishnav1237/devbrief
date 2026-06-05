export type RiskLabel =
  | 'SAFE'
  | 'REVIEW'
  | 'UPGRADE SOON'
  | 'RISKY'
  | 'EOL'
  | 'ACTION REQUIRED';

export type RecommendationAction =
  | 'ignore'
  | 'monitor'
  | 'review'
  | 'upgrade'
  | 'migrate'
  | 'replace'
  | 'remediate'
  | 'investigate';

export type FindingCategory =
  | 'dependency'
  | 'vulnerability'
  | 'runtime'
  | 'infra'
  | 'security'
  | 'service'
  | 'ops'
  | 'continuity'
  | 'cost'
  | 'impact'
  | 'remediation';

export type EcosystemName =
  | 'JavaScript/TypeScript'
  | 'Python'
  | 'Rust'
  | 'Go'
  | 'Java/JVM'
  | 'Container/Infra'
  | 'Unknown';

export interface ProjectProfile {
  ecosystems: EcosystemName[];
  packageManagers: string[];
  projectKinds: string[];
  projectRoots: string[];
  runtimeIndicators: string[];
  infraSignals: string[];
  securitySignals: string[];
  serviceSignals: string[];
}

export interface MaintenanceFinding {
  id: string;
  category: FindingCategory;
  label: RiskLabel;
  title: string;
  summary: string;
  evidence?: string;
  recommendation: RecommendationAction;
  urgency: number;
  impact: number;
  confidence: number;
  effort: 'none' | '5 min' | '20 min' | '1 hour+' | 'migration likely';
  packageName?: string;
  files?: string[];
  hiddenByDefault?: boolean;
  whyItMatters?: string;
}

export interface ScanStats {
  dependencies?: number;
  files?: number;
  packageManagers?: string[];
  ecosystems?: EcosystemName[];
  projectKinds?: string[];
  projectRoots?: string[];
  runtimeIndicators?: number;
  infraSignals?: number;
  securitySignals?: number;
  serviceSignals?: number;
  scannedAt: string;
}

export interface ScanResult {
  command: string;
  projectPath: string;
  summary: string;
  healthScore: number;
  healthBreakdown?: {
    runtime: number;
    dependencies: number;
    infrastructure: number;
    security: number;
  };
  findings: MaintenanceFinding[];
  ignored: MaintenanceFinding[];
  stats: ScanStats;
}

export interface ProjectDependency {
  name: string;
  version: string;
  ecosystem?: EcosystemName;
  type: 'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency' | 'requirement' | 'crate' | 'module' | 'maven' | 'gradle';
  isDev: boolean;
}

export interface ProjectContext {
  projectPath: string;
  packageJson?: {
    name?: string;
    version?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  dependencies: ProjectDependency[];
  lockPackages: Map<string, string>;
  profile: ProjectProfile;
  fingerprint: string;
  files: string[];
  sourceFiles: string[];
  configFiles: string[];
  dockerFiles: string[];
  workflowFiles: string[];
  envFiles: string[];
}

export interface Scanner {
  name: string;
  scan(context: ProjectContext): Promise<MaintenanceFinding[]>;
}
