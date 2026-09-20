// hook.mjs — 旧入口薄转发(试点期工作区配置仍指向此文件;逻辑在 lib/run-hook.mjs)
import("./lib/run-hook.mjs").then((m) => m.main());
