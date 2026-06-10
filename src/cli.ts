import { runPhase1Command } from "./cli/app.js";

const result = await runPhase1Command(process.argv.slice(2));
console.log(JSON.stringify(result, null, 2));
