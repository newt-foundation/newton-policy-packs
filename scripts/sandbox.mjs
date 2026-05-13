import { resolve } from "path";

const args = process.argv.slice(2).filter((a) => a !== "--");
const name = args[0];
if (!name) {
  console.error("Usage: pnpm run sandbox -- <policy_name>");
  process.exit(1);
}

const sandboxPath = resolve(`policies/${name}/sandbox.mjs`);
await import(sandboxPath);
