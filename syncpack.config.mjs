// @ts-check

/** @type {import("syncpack").RcFile} */
const config = {
  sortFirst: ['name', 'version', 'type', 'sideEffects', 'private', 'exports', 'types', 'typesVersions'],
  versionGroups: [
    {
      label: 'Use workspace protocol when developing local packages',
      dependencies: ['@livestore/**'],
      dependencyTypes: ['local', 'dev'],
      pinVersion: 'workspace:*',
    },
    {
      label: 'Force same Effect package versions',
      dependencies: ['effect'],
      dependencyTypes: ['local', 'dev', 'peer'],
      policy: 'sameRange',
    },
    {
      label: 'Force same Effect package versions',
      dependencies: ['effect'],
      dependencyTypes: ['local', 'dev', 'peer'],
      policy: 'sameRange',
    },
  ],
}

export default config
