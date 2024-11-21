import { Schema } from 'effect';
import { defineMutation, sql } from '@livestore/livestore';

export const createIssue = defineMutation(
  'createIssue',
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.Union(Schema.String, Schema.Null),
    parentIssueId: Schema.Union(Schema.String, Schema.Null),
    assigneeId: Schema.Union(Schema.String, Schema.Null),
    status: Schema.String,
    priority: Schema.String,
    createdAt: Schema.Union(Schema.Number, Schema.Null),
    updatedAt: Schema.Union(Schema.Number, Schema.Null),
  }),
  sql`INSERT INTO issues (id, title, description, parentIssueId, assigneeId, status, priority, createdAt, updatedAt) VALUES ($id, $title, $description, $parentIssueId, $assigneeId, $status, $priority, $createdAt, $updatedAt)`,
);

export const deleteIssue = defineMutation(
  'deleteIssue',
  Schema.Struct({ id: Schema.String }),
  sql`
    UPDATE issues 
    SET deletedAt = unixepoch() 
    WHERE id = $id
  `,
);

export const updateIssueTitle = defineMutation(
  'updateIssueTitle',
  Schema.Struct({ id: Schema.String, title: Schema.String }),
  sql`UPDATE issues SET title = $title, updatedAt = unixepoch() WHERE id = $id`,
);

export const updateIssueDescription = defineMutation(
  'updateIssueDescription',
  Schema.Struct({ id: Schema.String, description: Schema.String }),
  sql`UPDATE issues SET description = $description, updatedAt = unixepoch() WHERE id = $id`,
);

export const restoreIssue = defineMutation(
  'restoreIssue',
  Schema.Struct({ id: Schema.String }),
  sql`
    UPDATE issues 
    SET deletedAt = NULL 
    WHERE id = $id
  `,
);

export const createComment = defineMutation(
  'createComment',
  Schema.Struct({
    id: Schema.String,
    issueId: Schema.String,
    userId: Schema.String,
    content: Schema.String,
    createdAt: Schema.Union(Schema.Number, Schema.Null),
    updatedAt: Schema.Union(Schema.Number, Schema.Null),
  }),
  sql`INSERT INTO comments (id, issueId, userId, content, createdAt, updatedAt) VALUES ($id, $issueId, $userId, $content, $createdAt, $updatedAt)`,
);

export const createReaction = defineMutation(
  'createReaction',
  Schema.Struct({
    id: Schema.String,
    issueId: Schema.String,
    commentId: Schema.String,
    userId: Schema.String,
    emoji: Schema.String,
  }),
  sql`INSERT INTO reactions (id, issueId, commentId, userId, emoji) VALUES ($id, $issueId, $commentId, $userId, $emoji)`,
);

export const clearAll = defineMutation(
  'clearAll',
  Schema.Struct({ deleted: Schema.Number }),
  sql`UPDATE issues SET deletedAt = $deleted`,
);
