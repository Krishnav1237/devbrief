import { analyzeChangelog, ChangelogAnalysis } from './changelog-analyzer';
import { detectVulnerabilities, Vulnerability } from './vulnerability-detector';
import { ParsedDependency } from './package-parser';

export interface RiskClassification {
  riskLevel: 'CRITICAL' | 'BREAKING' | 'MINOR';
  severityScore: number; // 0-100
  affectsUserProject: boolean;
  reasoning: string;
  recommendations: string[];
  vulnerabilitiesFound?: Vulnerability[];
}

/**
 * Classifies the risk level of a library change based on changelog analysis,
 * vulnerability detection, and impact to user's actual dependencies.
 */
export async function classifyRisk(
  libraryName: string,
  version: string,
  changelogText: string,
  userDependencies: ParsedDependency[]
): Promise<RiskClassification> {
  // Analyze the changelog for patterns
  const changelogAnalysis = analyzeChangelog(changelogText);

  // Check if this library affects the user's project
  const userDep = userDependencies.find(
    dep => dep.name.toLowerCase() === libraryName.toLowerCase()
  );
  const affectsUserProject = !!userDep;

  // Build reasoning and classify risk
  let riskLevel: 'CRITICAL' | 'BREAKING' | 'MINOR' = 'MINOR';
  let severityScore = 0;
  const reasoningParts: string[] = [];
  const recommendations: string[] = [];
  let vulnerabilitiesFound: Vulnerability[] = [];

  // Detect if there are vulnerabilities for this library in the project
  try {
    const projectVulnerabilities = await detectVulnerabilities();
    vulnerabilitiesFound = projectVulnerabilities.filter(
      v => v.packageName.toLowerCase() === libraryName.toLowerCase()
    );
  } catch (err) {
    console.warn(
      `[risk-classifier] Vulnerability lookup failed for ${libraryName}:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  // Check for security issues/CVEs (CRITICAL)
  if (changelogAnalysis.hasSecurityFixes || vulnerabilitiesFound.length > 0) {
    riskLevel = 'CRITICAL';
    let securityConfidence = changelogAnalysis.confidenceScores.security;
    if (vulnerabilitiesFound.length > 0) {
      const maxVulnSeverity = vulnerabilitiesFound.reduce((max, v) => {
        const map = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 };
        return map[v.severity] > map[max] ? v.severity : max;
      }, 'LOW' as Vulnerability['severity']);
      
      const vulnScoreMap = { CRITICAL: 100, HIGH: 95, MODERATE: 85, LOW: 80 };
      severityScore = vulnScoreMap[maxVulnSeverity];
      reasoningParts.push(
        `Active security vulnerabilities detected in project: ${vulnerabilitiesFound.map(v => `${v.cveId || 'N/A'} (${v.severity})`).join(', ')}.`
      );
    } else {
      severityScore = 80 + Math.round(securityConfidence * 20);
      reasoningParts.push(
        `Security fixes detected in changelog with ${Math.round(securityConfidence * 100)}% confidence.`
      );
    }
    if (changelogAnalysis.securityDescriptions.length > 0) {
      reasoningParts.push(`Details: ${changelogAnalysis.securityDescriptions.join('; ')}`);
    }
    recommendations.push(vulnerabilitiesFound.length > 0 ? 'Update immediately - active project vulnerability' : 'Update immediately');
  }
  // Check for breaking changes (BREAKING)
  else if (changelogAnalysis.hasBreakingChanges) {
    riskLevel = 'BREAKING';
    severityScore = 60 + Math.round(changelogAnalysis.confidenceScores.breaking * 19);
    reasoningParts.push(
      `Breaking changes detected with ${Math.round(changelogAnalysis.confidenceScores.breaking * 100)}% confidence.`
    );
    if (changelogAnalysis.breakingChangeDescriptions.length > 0) {
      reasoningParts.push(`Changes: ${changelogAnalysis.breakingChangeDescriptions.join('; ')}`);
    }
    recommendations.push('Review changes and plan upgrade in next sprint');
  }
  // Check for deprecations (BREAKING)
  else if (changelogAnalysis.hasDeprecations) {
    riskLevel = 'BREAKING';
    severityScore = 50 + Math.round(changelogAnalysis.confidenceScores.deprecation * 9);
    reasoningParts.push(
      `Deprecations detected with ${Math.round(changelogAnalysis.confidenceScores.deprecation * 100)}% confidence.`
    );
    recommendations.push('Plan upgrade in next development cycle');
  }
  // Feature/patch (MINOR)
  else {
    riskLevel = 'MINOR';
    severityScore = changelogAnalysis.hasPerformanceImprovements ? 25 : 10;
    if (changelogAnalysis.hasPerformanceImprovements) {
      reasoningParts.push('Performance improvements included.');
      recommendations.push('Consider upgrading at next maintenance window');
    } else {
      reasoningParts.push('Feature or patch release with no breaking changes.');
      recommendations.push('Defer to next scheduled update cycle');
    }
  }

  // Add impact assessment
  if (affectsUserProject) {
    reasoningParts.push(
      `This library is in the project's ${userDep!.isDev ? 'devDependencies' : 'dependencies'}.`
    );
    if (riskLevel === 'CRITICAL') {
      recommendations[0] = vulnerabilitiesFound.length > 0
        ? 'Update immediately - active project vulnerability'
        : 'Update immediately - critical security issue';
    } else if (riskLevel === 'BREAKING' && !userDep!.isDev) {
      recommendations[0] = recommendations[0].replace('in next sprint', 'ASAP');
    }
  } else {
    reasoningParts.push('This library is not in the project dependencies.');
    recommendations.push('No action needed - does not affect project');
  }

  const reasoning = reasoningParts.join(' ');

  return {
    riskLevel,
    severityScore: Math.min(100, severityScore),
    affectsUserProject,
    reasoning,
    recommendations,
    vulnerabilitiesFound: vulnerabilitiesFound.length > 0 ? vulnerabilitiesFound : undefined,
  };
}
