/**
 * Simple sequence matcher ratio — similar to Python's difflib.SequenceMatcher.ratio().
 * Uses longest common subsequence to estimate similarity.
 */
export function sequenceMatcherRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const lcs = longestCommonSubsequenceLength(a, b);
  return (2.0 * lcs) / (a.length + b.length);
}

function longestCommonSubsequenceLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use two rows for space efficiency
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}
