import type { MaintenanceFinding, ProjectContext, Scanner } from './types.js';

export const javaScanner: Scanner = {
  name: 'java',
  async scan(context: ProjectContext): Promise<MaintenanceFinding[]> {
    if (!context.profile.ecosystems.includes('Java/JVM')) return [];

    const findings: MaintenanceFinding[] = [];
    const hasGradle = context.files.includes('build.gradle') || context.files.includes('build.gradle.kts');
    const hasWrapper = context.files.includes('gradlew') || context.files.includes('gradlew.bat');

    if (hasGradle && !hasWrapper) {
      findings.push({
        id: 'java:missing-gradle-wrapper',
        category: 'dependency',
        label: 'REVIEW',
        title: 'Gradle wrapper is missing',
        summary: 'Gradle build file found but no Gradle wrapper was found',
        evidence: 'a wrapper makes contributor and CI builds use the same Gradle version',
        recommendation: 'review',
        urgency: 3,
        impact: 4,
        confidence: 8,
        effort: '20 min',
        files: context.files.filter((file) => file === 'build.gradle' || file === 'build.gradle.kts'),
        hiddenByDefault: true,
      });
    }

    return findings;
  },
};
