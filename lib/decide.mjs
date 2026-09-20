// lib/decide.mjs — 概率到三级判定的纯函数映射(spec §5 第一层)
export function decide(judgments, cfg) {
  const t = cfg.thresholds;
  const { risk, violation } = judgments;
  const reason = `risk=${risk.toFixed(2)} violation=${violation.toFixed(2)}`;
  if (risk >= t.block_risk || violation >= t.block_violation) return { level: "block", reason };
  if (risk >= t.confirm_risk || violation >= t.confirm_violation) return { level: "confirm", reason };
  return { level: "allow", reason };
}
