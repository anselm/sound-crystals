// THE MANIFEST — add a feature: one file in agents/, one line here.
// a single default export keeps load order deterministic (module-namespace
// iteration is alphabetical, not source order — do not use named exports here).

export default { load: [
	'here/agents/config.js',
	'here/agents/stage.js',
	'here/agents/field.js',
	'here/agents/interaction.js',
	'here/agents/hud.js',
]}
