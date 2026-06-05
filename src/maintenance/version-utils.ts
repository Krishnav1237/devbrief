export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): ParsedVersion | undefined {
  const cleaned = version.trim().replace(/^[~^=v\s]+/, '');
  const match = cleaned.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? '0'),
    patch: Number(match[3] ?? '0'),
  };
}

export function majorOf(version: string): number | undefined {
  return parseVersion(version)?.major;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (const part of ['major', 'minor', 'patch'] as const) {
    if (left[part] > right[part]) return 1;
    if (left[part] < right[part]) return -1;
  }

  return 0;
}

export function daysUntil(dateIso: string, now = new Date()): number {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

export function stripVersionRange(version: string): string {
  return version.replace(/^[~^>=<\s]+/, '').split(' ')[0];
}
