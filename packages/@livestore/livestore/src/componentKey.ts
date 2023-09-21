type SingletonKey = { _tag: 'singleton'; componentName: string; id: 'singleton' }
type EphemeralKey = { _tag: 'ephemeral'; componentName: string; id: string }
type CustomKey = { _tag: 'custom'; componentName: string; id: string }

export type ComponentKey = SingletonKey | EphemeralKey | CustomKey

export const labelForKey = (key: ComponentKey): string => `${key.componentName}/${key.id}`

export const tableNameForComponentKey = (componentKey: ComponentKey) => `components__${componentKey.componentName}`
