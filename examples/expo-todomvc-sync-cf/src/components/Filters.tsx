import { useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { uiState$ } from '../livestore/queries.ts'
import { events } from '../livestore/schema.ts'
import { useAppStore } from '../livestore/store.ts'
import type { Filter } from '../types.ts'

export const Filters = () => {
  const store = useAppStore()
  const { filter } = store.useQuery(uiState$)

  const setFilter = useCallback((newFilter: Filter) => store.commit(events.uiStateSet({ filter: newFilter })), [store])
  const setAllFilter = useCallback(() => setFilter('all'), [setFilter])
  const setActiveFilter = useCallback(() => setFilter('active'), [setFilter])
  const setCompletedFilter = useCallback(() => setFilter('completed'), [setFilter])

  return (
    <View style={styles.container}>
      <Tag isActive={filter === 'all'} onPress={setAllFilter}>
        All
      </Tag>
      <Tag isActive={filter === 'active'} onPress={setActiveFilter}>
        Active
      </Tag>
      <Tag isActive={filter === 'completed'} onPress={setCompletedFilter}>
        Completed
      </Tag>
      <Text style={styles.storeId}>StoreId: {store.storeId}</Text>
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
  const tagStyle = StyleSheet.compose(styles.tag, isActive ? styles.tagActive : undefined)
  const tagTextStyle = StyleSheet.compose(styles.tagText, isActive ? styles.tagTextActive : undefined)

  return (
    <Pressable style={tagStyle} hitSlop={4} onPress={onPress}>
      <Text style={tagTextStyle}>{children}</Text>
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
  storeId: {
    alignSelf: 'center',
    color: '#BBB',
    fontSize: 12,
  },
})
