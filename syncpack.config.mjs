// @ts-check
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

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
    'types',
    'node-addons',
    'node',
    'browser',
    'react-native',
    'import',
    'require',
    'development',
    'production',
    'default',
  ],
  semverGroups: [
    {
      label: 'default all to exact version for prod deps',
      range: '',
      dependencyTypes: ['prod'],
      packages: ['**'],
    },
    {
      label: 'default all to patch range for peer deps',
      range: '~',
      dependencyTypes: ['peer'],
      packages: ['**'],
    },
    {
      label: 'default all to minor range for dev deps',
      range: '^',
      dependencyTypes: ['dev'],
      packages: ['**'],
    },
  ],
  versionGroups: [
    {
      label: 'use workspace protocol for local packages',
      dependencies: [...localPackages],
      dependencyTypes: ['!local'],
      // Except for standalone examples
      packages: ['!livestore-example-standalone-**'],
      pinVersion: 'workspace:*',
    },
  ],
}

export default config
