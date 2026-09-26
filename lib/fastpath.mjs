// lib/fastpath.mjs — 名单快路径(spec §6):MCP 豁免/白/黑名单;身份字段取自 identity.mjs(判定缓存见 cache.mjs)
import { toolIdentity } from "./identity.mjs";

export function matchFast(toolName, toolInput, cfg) {
  const id = toolIdentity(toolName, toolInput);
  if (id.kind === "mcp")
    return cfg.fastpath.mcp_allowlist.includes(id.server)
      ? { hit: true, level: "allow", source: "fastpath_mcp" } : { hit: false };
  if (id.kind !== "bash" || id.command === "") return { hit: false };
  for (const re of cfg.fastpath.allowlist) if (new RegExp(re).test(id.command)) return { hit: true, level: "allow", source: "fastpath_allow" };
  for (const re of cfg.fastpath.denylist) if (new RegExp(re).test(id.command)) return { hit: true, level: "block", source: "fastpath_block" };
  return { hit: false };
}
