// lib/decide.mjs — 概率到三级判定的纯函数映射(spec §5 第一层)
export function decide(judgments, cfg) {
  const t = cfg.thresholds;
  const { risk, violation } = judgments;
  // risk 是 0~3 期望值(3=破坏性不可逆),提示按满分 3 归一为百分比
  const reason = `破坏性风险=${Math.round((risk / 3) * 100)}% 红线违反=${Math.round(violation * 100)}%`;
  if (risk >= t.block_risk || violation >= t.block_violation) return { level: "block", reason };
  if (risk >= t.confirm_risk || violation >= t.confirm_violation) return { level: "confirm", reason };
  return { level: "allow", reason };
}
