import { Image } from 'expo-image'
import type { LinkProps } from 'expo-router'
import { Link } from 'expo-router'
import { memo, useMemo } from 'react'
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
    const pressableStyle = useMemo(
      () => StyleSheet.compose(styles.pressable, isDarkMode ? styles.pressableDark : styles.pressableLight),
      [isDarkMode],
    )
    const rippleConfig = useMemo(() => ({ color: isDarkMode ? '#333' : '#eee' }), [isDarkMode])

    return (
      <Link href={linkHref as LinkProps['href']} asChild>
        <Pressable style={pressableStyle} android_ripple={rippleConfig}>
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
  pressableDark: {
    backgroundColor: '#27272a',
  },
  pressableLight: {
    backgroundColor: '#fafafa',
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
  icon: {
    width: 16,
    height: 16,
  },
})

IssueItem.displayName = 'IssueItem'

export const PriorityIcon = memo(({ priority }: { priority: Priority }) => {
  const isDarkMode = useColorScheme() === 'dark'
  const iconSource = useMemo(() => {
    const iconByPriority: Record<Priority, string> = {
      none: isDarkMode ? iconBase64.no_priority_dark : iconBase64.no_priority,
      low: isDarkMode ? iconBase64.lowDark : iconBase64.low,
      medium: isDarkMode ? iconBase64.mediumDark : iconBase64.medium,
      high: isDarkMode ? iconBase64.highDark : iconBase64.high,
      urgent: isDarkMode ? iconBase64.urgentDark : iconBase64.urgent,
    }

    return toBase64ImageSource(iconByPriority[priority])
  }, [isDarkMode, priority])

  if (!iconSource) {
    return null
  }

  return <RNImage source={iconSource} style={styles.icon} />
})

export const IssueStatusIcon = memo(({ status }: { status: Status }) => {
  const iconSource = useMemo(() => {
    const iconByStatus: Record<Status, string> = {
      done: iconBase64.done,
      in_progress: iconBase64.in_progress,
      in_review: iconBase64.in_review,
      todo: iconBase64.todo,
      backlog: iconBase64.backlog,
      canceled: iconBase64.canceled,
      auto_closed: iconBase64.canceled,
      wont_fix: iconBase64.canceled,
      triage: iconBase64.triage,
    }

    return toBase64ImageSource(iconByStatus[status])
  }, [status])

  if (!iconSource) {
    return null
  }

  return <RNImage source={iconSource} style={styles.icon} />
})

const toBase64ImageSource = (icon: string) => ({
  uri: `data:image/png;base64,${icon}`,
  cache: 'force-cache' as const,
})
