import { Schema } from 'effect';
import { defineMutation, sql } from '@livestore/livestore';

import { Filter } from '../types';

export const addTodo = defineMutation(
  'addTodo',
  Schema.Struct({ id: Schema.String, text: Schema.String }),
  sql`INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)`,
);

export const completeTodo = defineMutation(
  'completeTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = true WHERE id = $id`,
);

export const uncompleteTodo = defineMutation(
  'uncompleteTodo',
  Schema.Struct({ id: Schema.String }),
  sql`UPDATE todos SET completed = false WHERE id = $id`,
);

export const deleteTodo = defineMutation(
  'deleteTodo',
  Schema.Struct({ id: Schema.String, deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE id = $id`,
);

export const clearCompleted = defineMutation(
  'clearCompleted',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted WHERE completed = true`,
);

export const clearAll = defineMutation(
  'clearAll',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE todos SET deleted = $deleted`,
);

export const updateNewTodoText = defineMutation(
  'updateNewTodoText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newTodoText = $text`,
);

export const updateNewIssueText = defineMutation(
  'updateNewIssueText',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newIssueText = $text`,
);

export const updateSelectedHomeTab = defineMutation(
  'updateSelectedHomeTab',
  Schema.Struct({ tab: Schema.String }),
  sql`UPDATE app SET selectedHomeTab = $tab`,
);

export const updateAssignedTabGrouping = defineMutation(
  'updateAssignedTabGrouping',
  Schema.Struct({ grouping: Schema.String }),
  sql`UPDATE app SET assignedTabGrouping = $grouping`,
);

export const updateAssignedTabOrdering = defineMutation(
  'updateAssignedTabOrdering',
  Schema.Struct({ ordering: Schema.String }),
  sql`UPDATE app SET assignedTabOrdering = $ordering`,
);

export const updateAssignedTabCompletedIssues = defineMutation(
  'updateAssignedTabCompletedIssues',
  Schema.Struct({ completedIssues: Schema.String }),
  sql`UPDATE app SET assignedTabCompletedIssues = $completedIssues`,
);

export const updateCreatedTabGrouping = defineMutation(
  'updateCreatedTabGrouping',
  Schema.Struct({ grouping: Schema.String }),
  sql`UPDATE app SET createdTabGrouping = $grouping`,
);

export const updateCreatedTabOrdering = defineMutation(
  'updateCreatedTabOrdering',
  Schema.Struct({ ordering: Schema.String }),
  sql`UPDATE app SET createdTabOrdering = $ordering`,
);

export const updateCreatedTabCompletedIssues = defineMutation(
  'updateCreatedTabCompletedIssues',
  Schema.Struct({ completedIssues: Schema.String }),
  sql`UPDATE app SET createdTabCompletedIssues = $completedIssues`,
);

export const updateAssignedTabShowAssignee = defineMutation(
  'updateAssignedTabShowAssignee',
  Schema.Struct({ showAssignee: Schema.Boolean }),
  sql`UPDATE app SET assignedTabShowAssignee = $showAssignee`,
);

export const updateAssignedTabShowStatus = defineMutation(
  'updateAssignedTabShowStatus',
  Schema.Struct({ showStatus: Schema.Boolean }),
  sql`UPDATE app SET assignedTabShowStatus = $showStatus`,
);

export const updateAssignedTabShowPriority = defineMutation(
  'updateAssignedTabShowPriority',
  Schema.Struct({ showPriority: Schema.Boolean }),
  sql`UPDATE app SET assignedTabShowPriority = $showPriority`,
);

export const updateCreatedTabShowAssignee = defineMutation(
  'updateCreatedTabShowAssignee',
  Schema.Struct({ showAssignee: Schema.Boolean }),
  sql`UPDATE app SET createdTabShowAssignee = $showAssignee`,
);

export const updateCreatedTabShowStatus = defineMutation(
  'updateCreatedTabShowStatus',
  Schema.Struct({ showStatus: Schema.Boolean }),
  sql`UPDATE app SET createdTabShowStatus = $showStatus`,
);

export const updateCreatedTabShowPriority = defineMutation(
  'updateCreatedTabShowPriority',
  Schema.Struct({ showPriority: Schema.Boolean }),
  sql`UPDATE app SET createdTabShowPriority = $showPriority`,
);

export const updateNewIssueDescription = defineMutation(
  'updateNewIssueDescription',
  Schema.Struct({ text: Schema.String }),
  sql`UPDATE app SET newIssueDescription = $text`,
);

export const setFilter = defineMutation(
  'setFilter',
  // @ts-ignore
  Schema.Struct({ filter: Filter }),
  sql`UPDATE app SET filter = $filter`,
);

export const updateNavigationHistory = defineMutation(
  'updateNavigationHistory',
  Schema.Struct({ history: Schema.String }),
  sql`UPDATE app SET navigationHistory = $history`,
);
