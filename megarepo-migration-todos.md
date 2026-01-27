- [x] expose packages via megarepo config
- [x] migrate away from createPackageJson to packageJson from @overeng/genie for all package.json.genie.ts files
- [x] test peer repos can consume livestore packages via megarepo setup
- [x] verify all genie is used consistently across livestore (except for examples)
- [x] fix [genie] tsconfig.json uses "extends" which is not recommended with Genie.
        Instead, import and spread the base config directly for better composability:
        compilerOptions: { ...baseTsconfigCompilerOptions, ...yourOptions }
- [ ] adjust ci
- [x] fully migrate from biome to oxlint/oxfmt
- [ ] load genie, megarepo via devenv from effect-utils
- [x] rethink setup script (e.g. auto install)
- [ ] think of a way to make megarepo opt in to improve contributor experience (e.g. auto link effect-utils somehow into the repo on checkout)
- [ ] delete this file (done by user)