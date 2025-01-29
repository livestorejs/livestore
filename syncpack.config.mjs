// @ts-check

/*
Semver cheat sheet: https://devhints.io/semver

Ranges:
~1.2.3	is >=1.2.3 <1.3.0	 
^1.2.3	is >=1.2.3 <2.0.0	 
^0.2.3	is >=0.2.3 <0.3.0 	(0.x.x is special)
^0.0.1	is =0.0.1	          (0.0.x is special)
^1.2	  is >=1.2.0 <2.0.0	  (like ^1.2.0)
~1.2	  is >=1.2.0 <1.3.0	  (like ~1.2.0)
*/

/** @type {import("syncpack").RcFile} */
const config = {
  sortFirst: ['name', 'version', 'type', 'sideEffects', 'private', 'exports', 'types', 'typesVersions'],
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
      dependencies: ['$LOCAL'],
      dependencyTypes: ['!local'],
      packages: ['!livestore-example-standalone-**'],
      pinVersion: 'workspace:*',
    },
    // {
    //   label: 'Force same Effect package versions',
    //   dependencies: ['effect'],
    //   dependencyTypes: ['local', 'dev', 'peer'],
    // },
    // {
    //   label: 'Force same Effect package versions',
    //   dependencies: ['@effect/**'],
    //   dependencyTypes: ['local', 'dev', 'peer'],

    // },
  ],
}

export default config
