import * as mutations from '@/lib/livestore/mutations'
import { comment, type Comment } from '@/lib/livestore/schema/comment'
import { description, type Description } from '@/lib/livestore/schema/description'
import { filterState, type FilterState } from '@/lib/livestore/schema/filter-state'
import { frontendState, type FrontendState } from '@/lib/livestore/schema/frontend-state'
import { issue, type Issue } from '@/lib/livestore/schema/issue'
import { makeSchema } from '@livestore/livestore'
import { scrollState, type ScrollState } from './scroll-state'

export {
  comment,
  description,
  filterState,
  frontendState,
  issue,
  mutations,
  scrollState,
  type Comment,
  type Description,
  type FilterState,
  type FrontendState,
  type Issue,
  type ScrollState,
}

export const tables = { issue, description, comment, filterState, frontendState, scrollState }
export const schema = makeSchema({ tables, mutations, migrations: { strategy: 'from-mutation-log' } })
