import { Events, Schema } from '@livestore/livestore'

// Issue Events
export const issueCreated = Events.synced({
  name: 'v1.IssueCreated',
  schema: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String.pipe(Schema.NullOr),
    parentIssueId: Schema.String.pipe(Schema.NullOr),
    assigneeId: Schema.String.pipe(Schema.NullOr),
    status: Schema.String,
    priority: Schema.String,
    createdAt: Schema.Date,
    updatedAt: Schema.Date,
  }),
})

export const issueDeleted = Events.synced({
  name: 'v1.IssueDeleted',
  schema: Schema.Struct({ id: Schema.String, deletedAt: Schema.Date }),
})

export const issueTitleUpdated = Events.synced({
  name: 'v1.IssueTitleUpdated',
  schema: Schema.Struct({ id: Schema.String, title: Schema.String, updatedAt: Schema.Date }),
})

export const issueDescriptionUpdated = Events.synced({
  name: 'v1.IssueDescriptionUpdated',
  schema: Schema.Struct({ id: Schema.String, description: Schema.String, updatedAt: Schema.Date }),
})

export const issueRestored = Events.synced({
  name: 'v1.IssueRestored',
  schema: Schema.Struct({ id: Schema.String }),
})

// User Events
export const userCreated = Events.synced({
  name: 'v1.UserCreated',
  schema: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String.pipe(Schema.NullOr),
    photoUrl: Schema.String.pipe(Schema.NullOr),
  }),
})

export const userDeleted = Events.synced({
  name: 'v1.UserDeleted',
  schema: Schema.Struct({ id: Schema.String }),
})

// Comment Events
export const commentCreated = Events.synced({
  name: 'v1.CommentCreated',
  schema: Schema.Struct({
    id: Schema.String,
    issueId: Schema.String,
    userId: Schema.String,
    content: Schema.String,
    createdAt: Schema.Date,
    updatedAt: Schema.Date,
  }),
})

// Reaction Events
export const reactionCreated = Events.synced({
  name: 'v1.ReactionCreated',
  schema: Schema.Struct({
    id: Schema.String,
    issueId: Schema.String,
    commentId: Schema.String,
    userId: Schema.String,
    emoji: Schema.String,
  }),
})

export const allCleared = Events.synced({
  name: 'v1.AllCleared',
  schema: Schema.Struct({ deletedAt: Schema.Date }),
})
