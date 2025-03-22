import { useQuery, useStore } from '@livestore/react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { app$ } from '../livestore/queries.ts'
import { mutations } from '../livestore/schema.ts'
import type { Filter } from '../types.ts'

export const Filters: React.FC = () => {
  const { store } = useStore()
  const { filter } = useQuery(app$)

  const setFilter = (filter: Filter) => store.commit(mutations.filterUpdated({ filter }))

  return (
    <View style={styles.container}>
      <Tag isActive={filter === 'all'} onPress={() => setFilter('all')}>
        All
      </Tag>
      <Tag isActive={filter === 'active'} onPress={() => setFilter('active')}>
        Active
      </Tag>
      <Tag isActive={filter === 'completed'} onPress={() => setFilter('completed')}>
        Completed
      </Tag>
      <Text style={{ alignSelf: 'center', color: '#BBB', fontSize: 12 }}>StoreId: {store.storeId}</Text>
    </View>
  )
}

const Tag = ({
  isActive,
  children,
  onPress,
}: {
  isActive: boolean
  onPress: () => void
  children: React.ReactNode
}) => {
  return (
    <Pressable style={[styles.tag, isActive && styles.tagActive]} hitSlop={4} onPress={onPress}>
      <Text style={[styles.tagText, isActive && styles.tagTextActive]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
  },
  tag: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dedede',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagActive: {
    borderColor: '#000',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  tagText: {
    color: '#969696',
  },
  tagTextActive: {
    color: '#000',
  },
})
