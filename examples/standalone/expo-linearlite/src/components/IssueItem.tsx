/* eslint-disable react/display-name */
import { Image } from 'expo-image'
import type { LinkProps } from 'expo-router'
import { Link } from 'expo-router'
import React, { memo } from 'react'
import { Image as RNImage, Pressable, useColorScheme, View } from 'react-native'

import { iconBase64 } from '@/assets/Icons/iconBase64.ts'
import type { Issue } from '@/livestore/schema.ts'
import type { Priority, Status } from '@/types.ts'

import { ThemedText } from './ThemedText.tsx'

export interface IssueItemProps {
  issue: Issue & {
    assigneePhotoUrl?: string
  }
  showAssignee?: boolean
  showStatus?: boolean
  showPriority?: boolean
}

const blurhash =
  '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj['

const IssueItem = memo(({ issue, showAssignee = true, showStatus = true, showPriority = true }: IssueItemProps) => {
  const linkHref = `/issue-details?issueId=${issue.id}`

  return (
    <Link href={linkHref as LinkProps['href']} asChild>
      <Pressable className="flex-row items-center justify-between gap-2 active:bg-zinc-100 dark:active:bg-zinc-800 rounded-md p-2 px-3">
        <View className="w-full flex-1 flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2 flex-shrink">
            {showPriority && <PriorityIcon priority={issue.priority as Priority} />}
            {showStatus && <IssueStatusIcon status={issue.status as Status} />}
            <ThemedText className="line-clamp-1 flex-shrink font-medium">{issue.title}</ThemedText>
          </View>
          {showAssignee && issue.assigneePhotoUrl && (
            <Image
              source={issue.assigneePhotoUrl}
              style={{ width: 20, height: 20, borderRadius: 10 }}
              placeholder={blurhash}
              transition={500}
              cachePolicy={'memory-disk'}
            />
          )}
        </View>
      </Pressable>
    </Link>
  )
})

IssueItem.displayName = 'IssueItem'

export default IssueItem

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
