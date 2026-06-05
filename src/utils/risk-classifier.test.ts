import { describe, it, expect } from 'vitest';
import { classifyRisk } from './risk-classifier';
import { ParsedDependency } from './package-parser';

describe('risk-classifier', () => {
  describe('classifyRisk', () => {
    it('should classify CRITICAL security update affecting user project', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: 'express',
          version: '^4.18.0',
          type: 'dependency',
          isDev: false,
          isOptional: false,
          isPeer: false,
        },
      ];

      const changelog = `
## Version 4.19.0

### Security
🚨 **CRITICAL SECURITY FIX**: Patched XSS vulnerability in middleware parser.

### Details
- CVE-2024-12345: Remote Code Execution via crafted request headers
- All versions < 4.19.0 are affected
- Upgrade immediately
      `;

      const result = await classifyRisk('express', '4.19.0', changelog, userDeps);

      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.severityScore).toBeGreaterThanOrEqual(80);
      expect(result.severityScore).toBeLessThanOrEqual(100);
      expect(result.affectsUserProject).toBe(true);
      expect(result.reasoning).toContain('Security fixes detected');
      expect(result.recommendations.some(rec => rec.includes('Update immediately'))).toBe(true);
    });

    it('should classify BREAKING change not affecting user (dev-only dependency)', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: '@types/node',
          version: '^18.0.0',
          type: 'devDependency',
          isDev: true,
          isOptional: false,
          isPeer: false,
        },
        {
          name: 'webpack',
          version: '^5.0.0',
          type: 'devDependency',
          isDev: true,
          isOptional: false,
          isPeer: false,
        },
      ];

      const changelog = `
## Version 6.0.0

### BREAKING CHANGES

- Removed support for Node.js 12 and 13
- Changed configuration API: old \`config.entry\` now requires webpack.Entry type
- Incompatible with webpack 4 and below

### Migration Guide
See https://webpack.js.org/migrate/6
      `;

      const result = await classifyRisk('rollup', '3.0.0', changelog, userDeps);

      expect(result.riskLevel).toBe('BREAKING');
      expect(result.severityScore).toBeGreaterThanOrEqual(60);
      expect(result.severityScore).toBeLessThanOrEqual(79);
      expect(result.affectsUserProject).toBe(false);
      expect(result.reasoning).toContain('Breaking changes detected');
      expect(result.reasoning).toContain('not in the project');
    });

    it('should classify MINOR feature update', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: 'lodash',
          version: '^4.17.0',
          type: 'dependency',
          isDev: false,
          isOptional: false,
          isPeer: false,
        },
      ];

      const changelog = `
## Version 4.18.0

New features and improvements in this release:
- Added debounceAsync utility for async functions
- Enhanced groupBy function with better performance
- Fixed edge case in uniq with null values
      `;

      const result = await classifyRisk('lodash', '4.18.0', changelog, userDeps);

      expect(result.riskLevel).toBe('MINOR');
      expect(result.severityScore).toBeGreaterThanOrEqual(0);
      expect(result.severityScore).toBeLessThanOrEqual(49);
      expect(result.affectsUserProject).toBe(true);
      expect(result.reasoning).toContain('Feature or patch release');
    });

    it('should handle unknown library not in project dependencies', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: 'react',
          version: '^18.0.0',
          type: 'dependency',
          isDev: false,
          isOptional: false,
          isPeer: false,
        },
      ];

      const changelog = `
## Version 1.0.0 - Initial Release

First stable release of unknown-library with core functionality.
      `;

      const result = await classifyRisk('unknown-library', '1.0.0', changelog, userDeps);

      expect(result.affectsUserProject).toBe(false);
      expect(result.reasoning).toContain('not in the project');
      expect(result.recommendations.some(rec => rec.includes('No action needed'))).toBe(true);
    });

    it('should classify deprecation as BREAKING risk', async () => {
      const userDeps: ParsedDependency[] = [
        {
          name: 'jquery',
          version: '^3.6.0',
          type: 'dependency',
          isDev: false,
          isOptional: false,
          isPeer: false,
        },
      ];

      const changelog = `
## Version 3.7.0

### Deprecations
The \`$.ajax\` method is now deprecated and will be removed in 4.0.
Please migrate to \`fetch\` API or axios.

End of life for this API: Version 4.0.0
      `;

      const result = await classifyRisk('jquery', '3.7.0', changelog, userDeps);

      expect(result.riskLevel).toBe('BREAKING');
      expect(result.severityScore).toBeGreaterThanOrEqual(50);
      expect(result.severityScore).toBeLessThanOrEqual(59);
      expect(result.affectsUserProject).toBe(true);
      expect(result.reasoning).toContain('Deprecations detected');
    });
  });
});
