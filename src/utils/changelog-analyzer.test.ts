import { describe, it, expect } from 'vitest';
import { analyzeChangelog, ChangelogAnalysis } from './changelog-analyzer';

describe('analyzeChangelog', () => {
  it('should detect clear BREAKING CHANGE section', () => {
    const changelog = `
## Version 2.0.0

### BREAKING CHANGES
- Removed support for Node.js 12
- API endpoint /users/list has been renamed to /users
- Database schema migration required
- Configuration format has changed

Other changes:
- Bug fixes
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.breakingChangeDescriptions.length).toBeGreaterThan(0);
    expect(result.confidenceScores.breaking).toBeGreaterThan(0.5);
    expect(
      result.breakingChangeDescriptions.some(desc =>
        desc.toLowerCase().includes('breaking')
      )
    ).toBe(true);
  });

  it('should detect SECURITY fixes', () => {
    const changelog = `
## Security Update

### SECURITY FIXES
- CVE-2024-1234: Fixed XSS vulnerability in user input handling
- Patched SQL injection vulnerability in search functionality
- 🚨 SECURITY: Updated crypto dependencies to address potential timing attacks

### Regular Updates
- Added new features
- Performance improvements
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasSecurityFixes).toBe(true);
    expect(result.securityDescriptions.length).toBeGreaterThan(0);
    expect(result.confidenceScores.security).toBeGreaterThan(0.5);
    expect(
      result.securityDescriptions.some(desc =>
        desc.toLowerCase().includes('cve') ||
        desc.toLowerCase().includes('security')
      )
    ).toBe(true);
  });

  it('should detect deprecations', () => {
    const changelog = `
## Version 1.5.0

### Deprecations
- Deprecated: old_api() will be removed in version 2.0
- The config.legacy_mode option is deprecated, use config.mode instead
- Deprecated support for IE 11

### New Features
- Added new streamlined API
- Better configuration options
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasDeprecations).toBe(true);
    expect(result.confidenceScores.deprecation).toBeGreaterThan(0.3);
  });

  it('should detect performance improvements', () => {
    const changelog = `
## Version 1.4.0

### Performance
- 50% faster rendering with optimized diff algorithm
- Reduced memory footprint by 30%
- Implemented lazy loading for large datasets
- Added caching layer to database queries

### Features
- New dashboard component
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasPerformanceImprovements).toBe(true);
  });

  it('should return false for changelog with minor features only', () => {
    const changelog = `
## Version 1.3.0

### New Features
- Added export to CSV functionality
- Improved button styling
- Better error messages

### Bug Fixes
- Fixed typo in documentation
- Corrected color scheme in dark mode
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(false);
    expect(result.hasSecurityFixes).toBe(false);
    expect(result.hasDeprecations).toBe(false);
    expect(result.hasPerformanceImprovements).toBe(false);
    expect(result.breakingChangeDescriptions.length).toBe(0);
    expect(result.securityDescriptions.length).toBe(0);
  });

  it('should handle case-insensitive matching', () => {
    const changelog = `
# Changes

- breaking change in the API
- security update required
- deprecated the old method
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.hasSecurityFixes).toBe(true);
    expect(result.hasDeprecations).toBe(true);
  });

  it('should detect CVE references', () => {
    const changelog = `
## Security Release

- Fixed CVE-2024-12345 in authentication module
- Patched CVE-2024-12346 reported by security team
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasSecurityFixes).toBe(true);
    expect(result.securityDescriptions.length).toBeGreaterThan(0);
    expect(result.securityDescriptions.some(desc => desc.includes('CVE-2024'))).toBe(true);
  });

  it('should calculate confidence scores between 0 and 1', () => {
    const changelog = `
BREAKING CHANGE: This is a major change
SECURITY FIX: Critical vulnerability patched
    `;

    const result = analyzeChangelog(changelog);

    expect(result.confidenceScores.breaking).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScores.breaking).toBeLessThanOrEqual(1);
    expect(result.confidenceScores.security).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScores.security).toBeLessThanOrEqual(1);
    expect(result.confidenceScores.deprecation).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScores.deprecation).toBeLessThanOrEqual(1);
  });

  it('should handle empty or null changelog', () => {
    const result1 = analyzeChangelog('');
    const result2 = analyzeChangelog('   ');

    expect(result1.hasBreakingChanges).toBe(false);
    expect(result1.hasSecurityFixes).toBe(false);
    expect(result1.hasDeprecations).toBe(false);
    expect(result1.hasPerformanceImprovements).toBe(false);
    expect(result1.confidenceScores.breaking).toBe(0);

    expect(result2.hasBreakingChanges).toBe(false);
    expect(result2.confidenceScores.breaking).toBe(0);
  });

  it('should extract meaningful context around matches', () => {
    const changelog = `
Version 1.0.0 released

BREAKING CHANGE: We renamed the getUserData() method.
The old method will no longer work after this update.
Please use getUser() instead.

Other changes follow...
    `;

    const result = analyzeChangelog(changelog);

    expect(result.breakingChangeDescriptions.length).toBeGreaterThan(0);
    const desc = result.breakingChangeDescriptions[0];
    expect(desc.toLowerCase()).toContain('breaking');
    expect(desc.length).toBeGreaterThan(10); // Should contain context
  });

  it('should detect multiple instances and avoid duplicates', () => {
    const changelog = `
## Breaking Changes

BREAKING CHANGE: Removed the old API
Please migrate to the new API as the old one is no longer supported.

BREAKING CHANGE: Removed legacy format
The old format is no longer supported.
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
    // Should have deduplicated similar descriptions
    expect(result.breakingChangeDescriptions.length).toBeLessThanOrEqual(2);
  });

  it('should handle emoji markers', () => {
    const changelog = `
## Release Notes

⚠️ breaking changes ahead - removed deprecated API
🚨 SECURITY: Critical fix for authentication bypass

Changes have been made to improve performance.
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.hasSecurityFixes).toBe(true);
  });

  it('should detect incompatible changes and removals', () => {
    const changelog = `
## Version 3.0.0

- Removed support for Python 3.6
- No longer supports IE 10
- Incompatible change: database format updated
- We removed the deprecated logger API

### Features
- Added new logger module
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
  });

  it('should detect end-of-life and removal notices', () => {
    const changelog = `
## Maintenance Notice

- MySQL 5.5 support has reached end of life
- NodeJS 10 will no longer be maintained after this release
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasDeprecations).toBe(true);
  });

  it('should handle real-world complex changelog', () => {
    const changelog = `
# Express 4.19.0 Changelog

## New Features
- Added support for async error handling

## BREAKING CHANGES
- Removed support for Node.js < 14
- req.ip now returns IPv6 addresses with brackets

## Security
- Fixed CVE-2023-12345: Express Middleware Vulnerability
- Patched denial of service vulnerability in routing

## Deprecated
- express.bodyParser is deprecated, use body-parser instead
- The legacy middleware stack is deprecated

## Performance Improvements
- Optimized routing engine for 20% faster lookups
- Reduced memory usage in middleware chain
    `;

    const result = analyzeChangelog(changelog);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.hasSecurityFixes).toBe(true);
    expect(result.hasDeprecations).toBe(true);
    expect(result.hasPerformanceImprovements).toBe(true);

    // Verify descriptions are present
    expect(result.breakingChangeDescriptions.length).toBeGreaterThan(0);
    expect(result.securityDescriptions.length).toBeGreaterThan(0);

    // Verify confidence scores
    expect(result.confidenceScores.breaking).toBeGreaterThan(0.5);
    expect(result.confidenceScores.security).toBeGreaterThan(0.5);
    expect(result.confidenceScores.deprecation).toBeGreaterThan(0.3);
  });
});
