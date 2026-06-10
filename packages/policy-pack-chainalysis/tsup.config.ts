import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	platform: "neutral",
	target: "es2022",
	external: ["viem", "zod", "@newton-xyz/policy-pack-shared"],
});
