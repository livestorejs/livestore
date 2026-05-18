// NOTE We have a separate module for type level declarations as those are only available in CF worker environments
// and we need to avoid importing them from other environments.
export * as CfDeclare from './cf-declare.ts'
