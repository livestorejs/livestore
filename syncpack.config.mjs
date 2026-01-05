// @ts-check
import fs, { readFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'
const getCatalogDependencies = () => {
  const rootPackageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  const catalog = rootPackageJson.catalog ?? {}
  return Object.keys(catalog)
}

const getCatalogVersions = () => {
  const rootPackageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  return rootPackageJson.catalog ?? {}
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

// Only include actual packages (directories that contain a package.json)
// This avoids accidentally treating placeholder/moved folders as local packages
const localPackages = fs
  .readdirSync(path.join(__dirname, './packages/@livestore'))
  .filter((dir) => fs.statSync(path.join(__dirname, './packages/@livestore', dir)).isDirectory())
  .filter((dir) => fs.existsSync(path.join(__dirname, './packages/@livestore', dir, 'package.json')))
  .map((dir) => `@livestore/${dir}`)

const catalogDependencies = getCatalogDependencies()
const catalogVersions = getCatalogVersions()

const catalogVersionGroups = Object.entries(catalogVersions).map(([dependency]) => ({
  label: `catalog dependency: ${dependency}`,
  dependencies: [dependency],
  dependencyTypes: ['!local', '!peer'],
  packages: ['!livestore-example-**', '!livestore-tutorial-starter', '!@local/docs', '!@local/tests-*', '!docs-code-snippets'],
  pinVersion: 'catalog:',
}))

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
      packages: ['!livestore-example-**', '!livestore-tutorial-starter'],
      pinVersion: 'workspace:*',
    },
    ...catalogVersionGroups,
    {
      label: 'ignore catalog dependencies in docs/examples/tests',
      dependencies: catalogDependencies,
      dependencyTypes: ['!local', '!peer'],
      packages: [
        '@local/docs',
        'docs-code-snippets',
        '@local/tests-*',
        'livestore-example-**',
        'livestore-tutorial-starter',
      ],
      isIgnored: true,
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
    {
      label: 'ignore overrides and resolutions',
      // overrides require exact versions to work correctly
      dependencyTypes: ['overrides', 'resolutions'],
      packages: ['**'],
      isIgnored: true,
    },
    {
      // NativeWind / Tailwind CSS v4 preview is still unstable on RN (memory leak tracked in https://github.com/nativewind/nativewind/issues/1669), so keep Expo Linearlite on v3.
      label: 'expo-linearlite tailwindcss stays on v3',
      dependencies: ['tailwindcss'],
      dependencyTypes: ['dev'],
      packages: ['livestore-example-expo-linearlite'],
      pinVersion: '^3.4.14',
    },
  ],
  semverGroups: [
    {
      label: 'ignore catalog dependencies',
      dependencies: catalogDependencies,
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
