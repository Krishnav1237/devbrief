export interface ChangelogAnalysis {
  hasBreakingChanges: boolean;
  hasSecurityFixes: boolean;
  hasDeprecations: boolean;
  hasPerformanceImprovements: boolean;
  breakingChangeDescriptions: string[];
  securityDescriptions: string[];
  confidenceScores: {
    breaking: number;
    security: number;
    deprecation: number;
  };
}

const BREAKING_PATTERNS = [
  /BREAKING\s+CHANGE[S]?/gi,
  /breaking\s+change[s]?/gi,
  /⚠️.*breaking/gi,
  /incompatible\s+(change|update)/gi,
  /no\s+longer\s+support/gi,
  /removed\s+\w+\s+api/gi,
];

const SECURITY_PATTERNS = [
  /SECURITY/gi,
  /CVE-\d{4}-\d{4,}/gi,
  /security\s+fix/gi,
  /🚨.*security/gi,
  /vulnerability/gi,
  /xss|csrf|sql\s+injection|remote\s+code\s+execution/gi,
  /cve\s+fix/gi,
];

const DEPRECATION_PATTERNS = [
  /deprecated?/gi,
  /will\s+be\s+removed/gi,
  /no\s+longer\s+(support|maintain)/gi,
  /end\s+of\s+life/gi,
];

const PERFORMANCE_PATTERNS = [
  /performance\s+improve/gi,
  /faster|speed|optimized?/gi,
  /reduce[ds]?\s+memory/gi,
  /lazy\s+load/gi,
  /cache[d]?/gi,
];

/**
 * Extracts lines around a match for context
 */
function extractContext(text: string, match: RegExpMatchArray, contextLines: number = 2): string {
  const lines = text.split('\n');
  let currentPos = 0;
  let lineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const nextPos = currentPos + lines[i].length + 1;
    if (match.index! >= currentPos && match.index! < nextPos) {
      lineIndex = i;
      break;
    }
    currentPos = nextPos;
  }

  const startLine = Math.max(0, lineIndex - contextLines);
  const endLine = Math.min(lines.length - 1, lineIndex + contextLines);

  return lines.slice(startLine, endLine + 1).join('\n').trim();
}

/**
 * Calculates confidence score based on keyword proximity and context
 */
function calculateConfidence(matches: RegExpMatchArray[], text: string): number {
  if (matches.length === 0) return 0;

  let totalScore = 0;

  for (const match of matches) {
    let matchScore = 0.5; // Base confidence for any match

    // Increase confidence if match is in a heading or prominent position
    const lineStart = text.lastIndexOf('\n', match.index! - 1) + 1;
    const lineEnd = text.indexOf('\n', match.index!);
    const line = text.substring(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

    // Heading (starts with # or similar)
    if (line.match(/^#+\s/) || line.match(/^[=\-]{2,}$/)) {
      matchScore += 0.3;
    }

    // All caps or emphasized
    if (match[0].toUpperCase() === match[0]) {
      matchScore += 0.15;
    }

    totalScore += Math.min(1, matchScore);
  }

  // Average confidence score, capped at 1
  return Math.min(1, totalScore / matches.length);
}

/**
 * Finds all matches of patterns in text
 */
function findMatches(patterns: RegExp[], text: string): RegExpMatchArray[] {
  const matches: RegExpMatchArray[] = [];

  for (const pattern of patterns) {
    let match;
    // Reset global flag regex lastIndex
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      matches.push(match);
    }
  }

  return matches;
}

/**
 * Deduplicates descriptions by similarity
 */
function deduplicateDescriptions(descriptions: string[]): string[] {
  if (descriptions.length === 0) return [];

  // Sort by length (longest first) to prefer fuller descriptions
  const sorted = [...descriptions].sort((a, b) => b.length - a.length);
  const unique: string[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i].toLowerCase().trim();
    const isSimilar = unique.some(desc => {
      const descLower = desc.toLowerCase().trim();

      // Exact match or one is substring of the other
      if (descLower.includes(current) || current.includes(descLower)) {
        return true;
      }

      // Check word overlap
      const currentWords = new Set(current.split(/\s+/).filter(w => w.length > 2));
      const descWords = new Set(descLower.split(/\s+/).filter(w => w.length > 2));

      if (currentWords.size === 0 || descWords.size === 0) {
        return false;
      }

      const intersection = new Set([...currentWords].filter(w => descWords.has(w)));
      const overlapRatio = intersection.size / Math.min(currentWords.size, descWords.size);

      // Consider similar if 60% of words overlap
      return overlapRatio > 0.6;
    });

    if (!isSimilar) {
      unique.push(sorted[i]);
    }
  }

  return unique;
}

export function analyzeChangelog(changelogText: string): ChangelogAnalysis {
  if (!changelogText || typeof changelogText !== 'string') {
    return {
      hasBreakingChanges: false,
      hasSecurityFixes: false,
      hasDeprecations: false,
      hasPerformanceImprovements: false,
      breakingChangeDescriptions: [],
      securityDescriptions: [],
      confidenceScores: {
        breaking: 0,
        security: 0,
        deprecation: 0,
      },
    };
  }

  // Find all pattern matches
  const breakingMatches = findMatches(BREAKING_PATTERNS, changelogText);
  const securityMatches = findMatches(SECURITY_PATTERNS, changelogText);
  const deprecationMatches = findMatches(DEPRECATION_PATTERNS, changelogText);
  const performanceMatches = findMatches(PERFORMANCE_PATTERNS, changelogText);

  // Extract descriptions with context
  const breakingChangeDescriptions = deduplicateDescriptions(
    breakingMatches.map(m => extractContext(changelogText, m, 1))
  );
  const securityDescriptions = deduplicateDescriptions(
    securityMatches.map(m => extractContext(changelogText, m, 1))
  );

  // Calculate confidence scores
  const breakingConfidence = calculateConfidence(breakingMatches, changelogText);
  const securityConfidence = calculateConfidence(securityMatches, changelogText);
  const deprecationConfidence = calculateConfidence(deprecationMatches, changelogText);

  return {
    hasBreakingChanges: breakingMatches.length > 0,
    hasSecurityFixes: securityMatches.length > 0,
    hasDeprecations: deprecationMatches.length > 0,
    hasPerformanceImprovements: performanceMatches.length > 0,
    breakingChangeDescriptions,
    securityDescriptions,
    confidenceScores: {
      breaking: breakingConfidence,
      security: securityConfidence,
      deprecation: deprecationConfidence,
    },
  };
}
