export interface DiffReplacement {
  original: string;
  modified: string;
}

/**
 * Computes the difference between two strings and returns a list of replacements.
 * This uses a word-level Longest Common Subsequence (LCS) algorithm.
 */
export function computeWordDiff(
  original: string,
  modified: string
): DiffReplacement[] {
  // Optimization: if strings are identical, return no changes
  if (original === modified) return [];

  // Tokenize using a regex that keeps delimiters (whitespace and punctuation)
  // This ensures that we can reconstruct the exact strings.
  // We want to treat '[PLACEHOLDER]' as a single token if possible, but our regex will likely split it.
  // However, since we are diffing, as long as the sequence of tokens corresponds to the replacement, it's fine.

  // Regex explanation:
  // \s+ : one or more whitespace characters
  // [^\w\s] : any non-word non-whitespace character (punctuation)
  // We capture these delimiters so they become part of the token array.
  // BUT we want "word" to be a token, " " to be a token.
  // Splitting by `(\s+|[^\w\s])` will do: "Hello, world" -> ["Hello", ",", " ", "world"] (empty strings might appear if delimiters are adjacent)

  const tokenize = (text: string) =>
    text.split(/(\s+|[^\w\s])/).filter((t) => t.length > 0);

  const tokensO = tokenize(original);
  const tokensM = tokenize(modified);

  const N = tokensO.length;
  const M = tokensM.length;

  // DP table for LCS
  // dp[i][j] stores the length of LCS of tokensO[0..i-1] and tokensM[0..j-1]
  const dp: number[][] = Array(N + 1)
    .fill(0)
    .map(() => Array(M + 1).fill(0));

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      if (tokensO[i - 1] === tokensM[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find changes
  const changes: { type: "eq" | "del" | "ins"; value: string }[] = [];
  let i = N,
    j = M;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensO[i - 1] === tokensM[j - 1]) {
      changes.push({ type: "eq", value: tokensO[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.push({ type: "ins", value: tokensM[j - 1] });
      j--;
    } else {
      changes.push({ type: "del", value: tokensO[i - 1] });
      i--;
    }
  }
  changes.reverse();

  // Group contiguous runs of del/ins into replacements
  const replacements: DiffReplacement[] = [];
  let currentOriginal = "";
  let currentModified = "";
  let pendingChange = false;

  for (const change of changes) {
    if (change.type === "eq") {
      if (pendingChange) {
        // End of a change block, push it
        if (currentOriginal !== currentModified) {
          // Should always be true if pendingChange is set?
          // Only push if there IS a difference.
          // (Though del/ins implies diff, but check just in case)
          replacements.push({
            original: currentOriginal,
            modified: currentModified,
          });
        }
        currentOriginal = "";
        currentModified = "";
        pendingChange = false;
      }
    } else {
      pendingChange = true;
      if (change.type === "del") {
        currentOriginal += change.value;
      } else if (change.type === "ins") {
        currentModified += change.value;
      }
    }
  }

  // Flush last change if exists
  if (pendingChange) {
    replacements.push({ original: currentOriginal, modified: currentModified });
  }

  return replacements;
}

/**
 * Parses diff markup string (e.g. <remove>...</remove><add>...</add>)
 * This is a placeholder as the previous implementation was likely removed or inlined.
 */
export function parseDiffMarkup(markup: string): any {
  // Placeholder implementation
  return { markup };
}
