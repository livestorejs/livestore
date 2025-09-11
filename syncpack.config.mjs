// @ts-check
import fs, { readFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { parse } from 'yaml'

const getPnpmCatalogDependencies = () => {
  const workspaceConfig = readFileSync('pnpm-workspace.yaml', 'utf8')
  const pnpmWorkspaceConfig = parse(workspaceConfig)

  return Object.keys(pnpmWorkspaceConfig.catalog)
}

/*
Semver calculator: https://semver.npmjs.com
Semver cheat sheet: https://devhints.io/semver

Ranges:
~1.2.3	is >=1.2.3 <1.3.0	 
^1.2.3	is >=1.2.3 <2.0.0	 
^0.2.3	is >=0.2.3 <0.3.0 	(0.x.x is special)
^0.0.1	is =0.0.1	          (0.0.x is special)
^1.2	  is >=1.2.0 <2.0.0	  (like ^1.2.0)
~1.2	  is >=1.2.0 <1.3.0	  (like ~1.2.0)
*/

// const __dirname = import.meta.dirname // use this once supported broadly
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const localPackages = fs
  .readdirSync(path.join(__dirname, './packages/@livestore'))
  .filter((dir) => fs.statSync(path.join(__dirname, './packages/@livestore', dir)).isDirectory())
  .map((dir) => `@livestore/${dir}`)

/** @type {import("syncpack").RcFile} */
const config = {
  sortFirst: ['name', 'version', 'type', 'sideEffects', 'private', 'exports', 'types', 'typesVersions'],
  sortExports: [
    'types', // should be first
    'workerd', // Cloudflare Workers (needs to be before browser)
    'browser',
    'worker',
    'node-addons',
    'node',
    'bun',
    'react-native',
    'import',
    'require',
    'development',
    'production',
    'default', // should be last
  ],
  versionGroups: [
    {
      label: 'workspace protocol for local packages',
      dependencies: [...localPackages, '@local/**'],
      dependencyTypes: ['!local'],
      // Except for examples
      packages: ['!livestore-example-**'],
      pinVersion: 'workspace:*',
    },
    {
      label: 'catalog protocol for catalog dependencies',
      dependencies: getPnpmCatalogDependencies(),
      // Exclude peer deps - they need explicit versions with ranges (e.g. ^19.0.0)
      // so published packages work with compatible versions, not just exact matches
      dependencyTypes: ['!local', '!peer'],
      // Except for examples
      packages: ['!livestore-example-**'],
      pinVersion: 'catalog:',
    },
    {
      label: 'ignore peer dependencies from version normalization',
      // Peer dependencies shouldn't influence version normalization of regular dependencies.
      // For example, if a package has peerDependencies: { "react": "^19.0.0" }, this shouldn't
      // force all other React dependencies to use ^19.0.0 format. Peer deps are still
      // subject to semver range enforcement (they must use ^ ranges), but they don't
      // participate in the "Default Version Group" normalization process.
      dependencyTypes: ['peer'],
      packages: ['**'],
      isIgnored: true,
    },
  ],
  semverGroups: [
    {
      label: 'ignore catalog dependencies',
      dependencies: getPnpmCatalogDependencies(),
      isIgnored: true,
      packages: ['**'],
    },
    {
      label: 'exact versions for prod dependencies',
      range: '',
      dependencyTypes: ['prod'],
      packages: ['**'],
    },
    {
      label: 'minor range for dev and peer dependencies',
      range: '^',
      dependencyTypes: ['dev', 'peer'],
      packages: ['**'],
    },
  ],
}

export default config
