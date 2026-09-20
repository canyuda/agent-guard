// check.mjs — 旧入口薄转发(逻辑在 lib/run-check.mjs)
import("./lib/run-check.mjs").then((m) => m.main(process.argv.slice(2)));
