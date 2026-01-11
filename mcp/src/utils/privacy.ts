/**
 * Match a file path against a glob pattern
 * Supports **, *, and literal matches
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Split pattern and path into segments
  const patternParts = pattern.split("/");
  const pathParts = filePath.split("/");

  function match(pIdx: number, fIdx: number): boolean {
    // Both exhausted - match
    if (pIdx >= patternParts.length && fIdx >= pathParts.length) {
      return true;
    }

    // Pattern exhausted but path not - no match
    if (pIdx >= patternParts.length) {
      return false;
    }

    const patternPart = patternParts[pIdx];

    // Handle **
    if (patternPart === "**") {
      // ** can match zero or more segments
      // Try matching zero segments (skip the **)
      if (match(pIdx + 1, fIdx)) {
        return true;
      }
      // Try matching one or more segments
      if (fIdx < pathParts.length && match(pIdx, fIdx + 1)) {
        return true;
      }
      // Try matching ** and moving to next pattern part
      if (fIdx < pathParts.length && match(pIdx + 1, fIdx + 1)) {
        return true;
      }
      return false;
    }

    // Path exhausted but pattern not (and it's not **) - no match
    if (fIdx >= pathParts.length) {
      return false;
    }

    const filePart = pathParts[fIdx];

    // Handle * and literal matches in a segment
    const segmentPattern = patternPart.replace(/\*/g, ".*");
    const regex = new RegExp(`^${segmentPattern}$`);

    if (regex.test(filePart)) {
      return match(pIdx + 1, fIdx + 1);
    }

    return false;
  }

  return match(0, 0);
}

/**
 * Check if a file path should be excluded based on privacy patterns
 *
 * @param filePath - The file path to check (can be relative or absolute)
 * @param excludePatterns - Array of glob patterns to exclude
 * @returns true if the file should be excluded, false otherwise
 */
export function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) {
    return false;
  }

  // Normalize the path - remove leading slash for consistent matching
  const normalizedPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;

  // Check against each pattern
  for (const pattern of excludePatterns) {
    if (matchGlob(normalizedPath, pattern)) {
      return true;
    }
  }

  return false;
}
