import { Image } from 'expo-image'
import type { LinkProps } from 'expo-router'
import { Link } from 'expo-router'
import { memo } from 'react'
import { Pressable, Image as RNImage, StyleSheet, useColorScheme, View } from 'react-native'

import { iconBase64 } from '../assets/Icons/iconBase64.ts'
import type { Issue } from '../livestore/schema.ts'
import type { Priority, Status } from '../types.ts'

import { ThemedText } from './ThemedText.tsx'

export interface IssueItemProps {
  issue: Pick<Issue, 'id' | 'title' | 'priority' | 'status'> & {
    assigneePhotoUrl?: string
  }
  showAssignee?: boolean
  showStatus?: boolean
  showPriority?: boolean
}

const blurhash =
  '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj['

export const IssueItem = memo(
  ({ issue, showAssignee = true, showStatus = true, showPriority = true }: IssueItemProps) => {
    const linkHref = `/issue-details?issueId=${issue.id}`
    const isDarkMode = useColorScheme() === 'dark'

    return (
      <Link href={linkHref as LinkProps['href']} asChild>
        <Pressable
          style={[styles.pressable, { backgroundColor: isDarkMode ? '#27272a' : '#fafafa' }]}
          android_ripple={{ color: isDarkMode ? '#333' : '#eee' }}
        >
          <View style={styles.container}>
            <View style={styles.leftContainer}>
              {showPriority && <PriorityIcon priority={issue.priority as Priority} />}
              {showStatus && <IssueStatusIcon status={issue.status as Status} />}
              <ThemedText style={styles.title}>{issue.title}</ThemedText>
            </View>
            {showAssignee && issue.assigneePhotoUrl && (
              <Image
                source={issue.assigneePhotoUrl}
                style={styles.avatar}
                placeholder={blurhash}
                transition={500}
                cachePolicy={'memory-disk'}
              />
            )}
          </View>
        </Pressable>
      </Link>
    )
  },
)

const styles = StyleSheet.create({
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 6,
    padding: 8,
    paddingHorizontal: 12,
  },
  container: {
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  title: {
    fontWeight: '500',
    flexShrink: 1,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
})

IssueItem.displayName = 'IssueItem'

export const PriorityIcon = memo(({ priority }: { priority: Priority }) => {
  const isDarkMode = useColorScheme() === 'dark'
  switch (priority) {
    case 'none': {
      const iconNoPriority = isDarkMode ? iconBase64.no_priority_dark : iconBase64.no_priority
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconNoPriority}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'low': {
      const iconLow = isDarkMode ? iconBase64.lowDark : iconBase64.low
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconLow}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'medium': {
      const iconMedium = isDarkMode ? iconBase64.mediumDark : iconBase64.medium
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconMedium}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'high': {
      const iconHigh = isDarkMode ? iconBase64.highDark : iconBase64.high
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconHigh}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'urgent': {
      const iconUrgent = isDarkMode ? iconBase64.urgentDark : iconBase64.urgent
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconUrgent}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    default: {
      return null
    }
  }
})

export const IssueStatusIcon = memo(({ status }: { status: Status }) => {
  switch (status) {
    case 'done': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.done}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'in_progress': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.in_progress}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'in_review': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.in_review}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'todo': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.todo}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'backlog': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.backlog}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'canceled':
    case 'auto_closed':
    case 'wont_fix': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.canceled}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    case 'triage': {
      return (
        <RNImage
          source={{
            uri: `data:image/png;base64,${iconBase64.triage}`,
            cache: 'force-cache',
          }}
          style={{ width: 16, height: 16 }}
        />
      )
    }
    default: {
      return null
    }
  }
})
