/**
 * 轻量行级 diff（LCS 算法）。
 *
 * 用于 ChangesView 展示「修改前 vs 修改后」的差异。
 * 不引第三方库，O(n*m) DP 求最长公共子序列，再回溯生成 diff 行。
 * 大文件截断（默认前 500 行）避免性能问题。
 */
export interface DiffLine {
  /** 行内容（不含换行）。 */
  text: string;
  /** 行类型：context=未变，add=新增，del=删除。 */
  type: "context" | "add" | "del";
}

/** 最大 diff 行数，超出截断（避免大文件 O(n²) 性能问题）。 */
const MAX_LINES = 500;

/**
 * 对比两段文本，返回行级 diff。
 * @param base 原始内容（修改前）；null 表示全新文件（全部为 add）
 * @param current 当前内容（修改后）；null 表示删除（全部为 del，基于 base）
 */
export function diffLines(
  base: string | null,
  current: string | null,
): DiffLine[] {
  // 全新文件：current 全部为 add
  if (base === null) {
    return (current ?? "")
      .split("\n")
      .slice(0, MAX_LINES)
      .map((text) => ({ text, type: "add" as const }));
  }
  // 删除文件：base 全部为 del
  if (current === null) {
    return base
      .split("\n")
      .slice(0, MAX_LINES)
      .map((text) => ({ text, type: "del" as const }));
  }

  const a = base.split("\n").slice(0, MAX_LINES);
  const b = current.split("\n").slice(0, MAX_LINES);

  // LCS DP 表
  const m = a.length;
  const n = b.length;
  // dp[i][j] = a[0..i) 与 b[0..j) 的 LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ text: a[i - 1], type: "context" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ text: b[j - 1], type: "add" });
      j--;
    } else {
      result.unshift({ text: a[i - 1], type: "del" });
      i--;
    }
  }
  return result;
}
