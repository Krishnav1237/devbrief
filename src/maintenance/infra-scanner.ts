import { readProjectFile } from './project-context.js';
import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

function finding(
  id: string,
  label: MaintenanceFinding['label'],
  summary: string,
  evidence: string,
  files: string[],
  recommendation: MaintenanceFinding['recommendation'] = 'upgrade',
): MaintenanceFinding {
  return {
    id,
    category: 'infra',
    label,
    title: summary,
    summary,
    evidence,
    recommendation,
    urgency: label === 'ACTION REQUIRED' ? 10 : label === 'EOL' ? 8 : label === 'RISKY' ? 8 : 5,
    impact: label === 'ACTION REQUIRED' ? 10 : label === 'EOL' ? 8 : 7,
    confidence: 9,
    effort: '20 min',
    files,
  };
}

export const infraScanner: Scanner = {
  name: 'infra',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    const findings: MaintenanceFinding[] = [];

    const isKubernetesFile = (file: string): boolean => {
      if (!(file.endsWith('.yml') || file.endsWith('.yaml'))) return false;
      const name = file.split('/').pop() ?? file;
      return name.includes('k8s') || name.includes('kubernetes') || name === 'deployment.yaml' || name === 'service.yaml' || name === 'ingress.yaml' || name === 'pod.yaml';
    };

    const k8sFiles = context.files.filter(isKubernetesFile);
    const scanFiles = [...new Set([
      ...context.dockerFiles,
      ...context.workflowFiles,
      ...context.files.filter((name) => name.endsWith('.tf')),
      ...k8sFiles
    ])];

    for (const file of scanFiles) {
      let content = '';
      try {
        content = readProjectFile(context, file);
      } catch {
        continue;
      }

      const nodeMatch = content.match(/FROM\s+node:(\d+)(?:\D|$)/i);
      if (nodeMatch) {
        const major = parseInt(nodeMatch[1], 10);
        if (major < 22) {
          findings.push(finding(
            `infra:docker-node:${file}`,
            'EOL',
            'Docker image pins an EOL or recently EOL Node runtime',
            'use a supported LTS image and test native dependencies',
            [file],
          ));
        }
      }

      if (/FROM\s+.*:latest\b/i.test(content)) {
        findings.push(finding(
          `infra:docker-latest:${file}`,
          'REVIEW',
          'Docker image uses a floating latest tag',
          'pin a major/minor tag or digest for reproducible builds',
          [file],
          'review',
        ));
      }

      if (/ubuntu-(18\.04|20\.04)/.test(content)) {
        findings.push(finding(
          `infra:ubuntu-runner:${file}`,
          'UPGRADE SOON',
          'CI uses an old Ubuntu runner image',
          'move to ubuntu-24.04 when compatible',
          [file],
        ));
      }

      const oldActions = content.matchAll(/uses:\s*([^@\s]+)@(v[123]|master|main)\b/g);
      for (const match of oldActions) {
        const action = match[1];
        const version = match[2];
        findings.push(finding(
          `infra:action:${file}:${action}:${version}`,
          version === 'v1' || version === 'v2' ? 'UPGRADE SOON' : 'REVIEW',
          `${action}@${version} should be reviewed`,
          version === 'master' || version === 'main'
            ? 'branch-pinned actions can change without review'
            : 'older action major may run on deprecated Node internals',
          [file],
          version === 'master' || version === 'main' ? 'review' : 'upgrade',
        ));
      }

      if (/privileged:\s*true/.test(content)) {
        findings.push(finding(
          `infra:privileged:${file}`,
          'RISKY',
          'Container runs in privileged mode',
          'keep only if the workload truly needs host-level access',
          [file],
          'investigate',
        ));
      }

      if (/prevent_destroy\s*=\s*false/.test(content)) {
        findings.push(finding(
          `infra:terraform-destroy:${file}`,
          'REVIEW',
          'Terraform explicitly allows destructive replacement',
          'confirm lifecycle policy before production use',
          [file],
          'review',
        ));
      }

      // Deep Infrastructure Check 1: Docker Socket exposure
      if (content.includes('/var/run/docker.sock')) {
        findings.push(finding(
          `infra:docker-socket-mount:${file}`,
          'ACTION REQUIRED',
          'Docker socket is mounted inside container',
          'avoid mounting /var/run/docker.sock to prevent container escape and host takeover',
          [file],
          'investigate'
        ));
      }

      const isCompose = /compose.*ya?ml/i.test(file);
      if (isCompose) {
        // Deep Infrastructure Check 2: Exposed Database Interface Binding (0.0.0.0)
        const portLineRegex = /-\s*['"]?(?:(?:0\.0\.0\.0|\[::\]):)?(\d+):(\d+)['"]?/g;
        const dbPorts = new Set(['5432', '6379', '27017', '3306', '9200', '1521']);
        let portMatch;
        while ((portMatch = portLineRegex.exec(content)) !== null) {
          const hostPort = portMatch[1];
          const containerPort = portMatch[2];
          if (dbPorts.has(containerPort) || dbPorts.has(hostPort)) {
            const startIndex = portMatch.index;
            const lineStart = content.lastIndexOf('\n', startIndex) + 1;
            const lineEnd = content.indexOf('\n', startIndex);
            const line = content.slice(lineStart, lineEnd !== -1 ? lineEnd : content.length);
            
            const isLocal = /127\.0\.0\.1|localhost|::1/.test(line);
            if (!isLocal) {
              findings.push(finding(
                `infra:exposed-db:${file}:${containerPort}`,
                'ACTION REQUIRED',
                `Database service port ${containerPort} is exposed globally (0.0.0.0)`,
                `bind the port to 127.0.0.1 to prevent unauthorized external access (e.g. "127.0.0.1:${containerPort}:${containerPort}")`,
                [file],
                'remediate'
              ));
            }
          }
        }

        // Deep Infrastructure Check 3: Host Path volume leakage
        const volumeRegex = /-\s*['"]?(\/[^:]*|~[^:]*):/g;
        let volumeMatch;
        while ((volumeMatch = volumeRegex.exec(content)) !== null) {
          const hostPath = volumeMatch[1].trim();
          const isSensitive = 
            hostPath === '/' || 
            hostPath.startsWith('/etc') || 
            hostPath.startsWith('/var') && !hostPath.includes('docker.sock') && !hostPath.includes('log') && !hostPath.includes('run/systemd') ||
            hostPath.startsWith('~/.ssh') || 
            hostPath.startsWith('~/.aws') || 
            hostPath.startsWith('~/.kube') || 
            hostPath.includes('.ssh') || 
            hostPath.includes('.aws') || 
            hostPath.includes('.kube');
            
          if (isSensitive) {
            findings.push(finding(
              `infra:sensitive-mount:${file}:${hostPath}`,
              'RISKY',
              `Container mounts a sensitive host path: ${hostPath}`,
              'restrict volume mounts to project-specific subdirectories to prevent host namespace escape',
              [file],
              'investigate'
            ));
          }
        }

        // Deep Infrastructure Check 4: Container Cap-Add Privilege Escalation
        if (/cap_add\s*:\s*\n(?:\s*-\s*.*\n?)*\s*-\s*(SYS_ADMIN|NET_ADMIN|ALL)/i.test(content) || /cap_add\s*:\s*\[[^]*?(SYS_ADMIN|NET_ADMIN|ALL)[^]*?\]/i.test(content)) {
          findings.push(finding(
            `infra:privileged-capability:${file}`,
            'RISKY',
            'Container is granted high-privilege Linux capabilities (SYS_ADMIN/NET_ADMIN)',
            'remove cap_add privileges unless absolutely required for host-level networking/control',
            [file],
            'investigate'
          ));
        }
      }

      // Deep Infrastructure Check 5: Kubernetes Pod Posture Policies
      const isK8s = isKubernetesFile(file) || content.includes('apiVersion:');
      if (isK8s) {
        if (/hostNetwork\s*:\s*true/i.test(content) || /hostPID\s*:\s*true/i.test(content) || /hostIPC\s*:\s*true/i.test(content)) {
          findings.push(finding(
            `infra:k8s-host-namespace:${file}`,
            'RISKY',
            'Kubernetes Pod shares host PID, IPC, or Network namespace',
            'isolate the pod namespace to prevent complete node takeover in case of compromise',
            [file],
            'investigate'
          ));
        }

        if (content.includes('kind: Pod') || content.includes('kind: Deployment') || content.includes('kind: StatefulSet') || content.includes('kind: DaemonSet')) {
          const hasRunAsNonRoot = /runAsNonRoot\s*:\s*true/i.test(content);
          const explicitlyFalse = /runAsNonRoot\s*:\s*false/i.test(content);
          
          if (explicitlyFalse || !hasRunAsNonRoot) {
            findings.push(finding(
              `infra:k8s-run-as-root:${file}`,
              'REVIEW',
              'Kubernetes container is configured to run as root or lacks runAsNonRoot safety',
              'set runAsNonRoot: true in the pod/container securityContext',
              [file],
              'review'
            ));
          }
        }
      }
    }

    if (findings.length === 0) {
      findings.push({
        id: 'infra:safe',
        category: 'infra',
        label: 'SAFE',
        title: 'No obvious infrastructure drift found',
        summary: 'Docker, CI, and IaC scan found no high-signal drift',
        recommendation: 'ignore',
        urgency: 0,
        impact: 0,
        confidence: 7,
        effort: 'none',
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
