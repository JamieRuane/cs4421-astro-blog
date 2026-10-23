import { spawnSync } from 'node:child_process';

function run(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		env,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build'], {
	...process.env,
	ASTRO_OUTPUT: 'static',
});
run(process.execPath, ['scripts/validate-security-policy.mjs']);
