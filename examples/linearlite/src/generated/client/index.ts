import { z } from 'zod';
import type { Prisma } from './prismaClient';
import { type TableSchema, DbSchema, Relation, ElectricClient, type HKT } from 'electric-sql/client/model';
import migrations from './migrations';

/////////////////////////////////////////
// HELPER FUNCTIONS
/////////////////////////////////////////


/////////////////////////////////////////
// ENUMS
/////////////////////////////////////////

export const CommentScalarFieldEnumSchema = z.enum(['id','body','creator','issueId','created']);

export const DescriptionScalarFieldEnumSchema = z.enum(['id','body']);

export const IssueScalarFieldEnumSchema = z.enum(['id','title','creator','priority','status','created','modified','kanbanorder']);

export const QueryModeSchema = z.enum(['default','insensitive']);

export const SortOrderSchema = z.enum(['asc','desc']);

export const TransactionIsolationLevelSchema = z.enum(['ReadUncommitted','ReadCommitted','RepeatableRead','Serializable']);
/////////////////////////////////////////
// MODELS
/////////////////////////////////////////

/////////////////////////////////////////
// COMMENT SCHEMA
/////////////////////////////////////////

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  issueId: z.string(),
  created: z.number().or(z.nan()),
})

export type Comment = z.infer<typeof CommentSchema>

/////////////////////////////////////////
// DESCRIPTION SCHEMA
/////////////////////////////////////////

export const DescriptionSchema = z.object({
  id: z.string(),
  body: z.string(),
})

export type Description = z.infer<typeof DescriptionSchema>

/////////////////////////////////////////
// ISSUE SCHEMA
/////////////////////////////////////////

export const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number().or(z.nan()),
  modified: z.number().or(z.nan()),
  kanbanorder: z.string(),
})

export type Issue = z.infer<typeof IssueSchema>

/////////////////////////////////////////
// SELECT & INCLUDE
/////////////////////////////////////////

// COMMENT
//------------------------------------------------------

export const CommentIncludeSchema: z.ZodType<Prisma.CommentInclude> = z.object({
  issue: z.union([z.boolean(),z.lazy(() => IssueArgsSchema)]).optional(),
}).strict()

export const CommentArgsSchema: z.ZodType<Prisma.CommentArgs> = z.object({
  select: z.lazy(() => CommentSelectSchema).optional(),
  include: z.lazy(() => CommentIncludeSchema).optional(),
}).strict();

export const CommentSelectSchema: z.ZodType<Prisma.CommentSelect> = z.object({
  id: z.boolean().optional(),
  body: z.boolean().optional(),
  creator: z.boolean().optional(),
  issueId: z.boolean().optional(),
  created: z.boolean().optional(),
  issue: z.union([z.boolean(),z.lazy(() => IssueArgsSchema)]).optional(),
}).strict()

// DESCRIPTION
//------------------------------------------------------

export const DescriptionIncludeSchema: z.ZodType<Prisma.DescriptionInclude> = z.object({
  issue: z.union([z.boolean(),z.lazy(() => IssueArgsSchema)]).optional(),
}).strict()

export const DescriptionArgsSchema: z.ZodType<Prisma.DescriptionArgs> = z.object({
  select: z.lazy(() => DescriptionSelectSchema).optional(),
  include: z.lazy(() => DescriptionIncludeSchema).optional(),
}).strict();

export const DescriptionSelectSchema: z.ZodType<Prisma.DescriptionSelect> = z.object({
  id: z.boolean().optional(),
  body: z.boolean().optional(),
  issue: z.union([z.boolean(),z.lazy(() => IssueArgsSchema)]).optional(),
}).strict()

// ISSUE
//------------------------------------------------------

export const IssueIncludeSchema: z.ZodType<Prisma.IssueInclude> = z.object({
  comment: z.union([z.boolean(),z.lazy(() => CommentFindManyArgsSchema)]).optional(),
  description: z.union([z.boolean(),z.lazy(() => DescriptionArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => IssueCountOutputTypeArgsSchema)]).optional(),
}).strict()

export const IssueArgsSchema: z.ZodType<Prisma.IssueArgs> = z.object({
  select: z.lazy(() => IssueSelectSchema).optional(),
  include: z.lazy(() => IssueIncludeSchema).optional(),
}).strict();

export const IssueCountOutputTypeArgsSchema: z.ZodType<Prisma.IssueCountOutputTypeArgs> = z.object({
  select: z.lazy(() => IssueCountOutputTypeSelectSchema).nullish(),
}).strict();

export const IssueCountOutputTypeSelectSchema: z.ZodType<Prisma.IssueCountOutputTypeSelect> = z.object({
  comment: z.boolean().optional(),
}).strict();

export const IssueSelectSchema: z.ZodType<Prisma.IssueSelect> = z.object({
  id: z.boolean().optional(),
  title: z.boolean().optional(),
  creator: z.boolean().optional(),
  priority: z.boolean().optional(),
  status: z.boolean().optional(),
  created: z.boolean().optional(),
  modified: z.boolean().optional(),
  kanbanorder: z.boolean().optional(),
  comment: z.union([z.boolean(),z.lazy(() => CommentFindManyArgsSchema)]).optional(),
  description: z.union([z.boolean(),z.lazy(() => DescriptionArgsSchema)]).optional(),
  _count: z.union([z.boolean(),z.lazy(() => IssueCountOutputTypeArgsSchema)]).optional(),
}).strict()


/////////////////////////////////////////
// INPUT TYPES
/////////////////////////////////////////

export const CommentWhereInputSchema: z.ZodType<Prisma.CommentWhereInput> = z.object({
  AND: z.union([ z.lazy(() => CommentWhereInputSchema),z.lazy(() => CommentWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => CommentWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => CommentWhereInputSchema),z.lazy(() => CommentWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  creator: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  issueId: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
  issue: z.union([ z.lazy(() => IssueRelationFilterSchema),z.lazy(() => IssueWhereInputSchema) ]).optional(),
}).strict();

export const CommentOrderByWithRelationInputSchema: z.ZodType<Prisma.CommentOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  issueId: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  issue: z.lazy(() => IssueOrderByWithRelationInputSchema).optional()
}).strict();

export const CommentWhereUniqueInputSchema: z.ZodType<Prisma.CommentWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const CommentOrderByWithAggregationInputSchema: z.ZodType<Prisma.CommentOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  issueId: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => CommentCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => CommentAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => CommentMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => CommentMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => CommentSumOrderByAggregateInputSchema).optional()
}).strict();

export const CommentScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.CommentScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => CommentScalarWhereWithAggregatesInputSchema),z.lazy(() => CommentScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => CommentScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => CommentScalarWhereWithAggregatesInputSchema),z.lazy(() => CommentScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  creator: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  issueId: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
}).strict();

export const DescriptionWhereInputSchema: z.ZodType<Prisma.DescriptionWhereInput> = z.object({
  AND: z.union([ z.lazy(() => DescriptionWhereInputSchema),z.lazy(() => DescriptionWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => DescriptionWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DescriptionWhereInputSchema),z.lazy(() => DescriptionWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  issue: z.union([ z.lazy(() => IssueRelationFilterSchema),z.lazy(() => IssueWhereInputSchema) ]).optional(),
}).strict();

export const DescriptionOrderByWithRelationInputSchema: z.ZodType<Prisma.DescriptionOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  issue: z.lazy(() => IssueOrderByWithRelationInputSchema).optional()
}).strict();

export const DescriptionWhereUniqueInputSchema: z.ZodType<Prisma.DescriptionWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const DescriptionOrderByWithAggregationInputSchema: z.ZodType<Prisma.DescriptionOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => DescriptionCountOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => DescriptionMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => DescriptionMinOrderByAggregateInputSchema).optional()
}).strict();

export const DescriptionScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.DescriptionScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => DescriptionScalarWhereWithAggregatesInputSchema),z.lazy(() => DescriptionScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => DescriptionScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => DescriptionScalarWhereWithAggregatesInputSchema),z.lazy(() => DescriptionScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const IssueWhereInputSchema: z.ZodType<Prisma.IssueWhereInput> = z.object({
  AND: z.union([ z.lazy(() => IssueWhereInputSchema),z.lazy(() => IssueWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => IssueWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => IssueWhereInputSchema),z.lazy(() => IssueWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  creator: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
  modified: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
  kanbanorder: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  comment: z.lazy(() => CommentListRelationFilterSchema).optional(),
  description: z.union([ z.lazy(() => DescriptionRelationFilterSchema),z.lazy(() => DescriptionWhereInputSchema) ]).optional().nullable(),
}).strict();

export const IssueOrderByWithRelationInputSchema: z.ZodType<Prisma.IssueOrderByWithRelationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  comment: z.lazy(() => CommentOrderByRelationAggregateInputSchema).optional(),
  description: z.lazy(() => DescriptionOrderByWithRelationInputSchema).optional()
}).strict();

export const IssueWhereUniqueInputSchema: z.ZodType<Prisma.IssueWhereUniqueInput> = z.object({
  id: z.string().optional()
}).strict();

export const IssueOrderByWithAggregationInputSchema: z.ZodType<Prisma.IssueOrderByWithAggregationInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional(),
  _count: z.lazy(() => IssueCountOrderByAggregateInputSchema).optional(),
  _avg: z.lazy(() => IssueAvgOrderByAggregateInputSchema).optional(),
  _max: z.lazy(() => IssueMaxOrderByAggregateInputSchema).optional(),
  _min: z.lazy(() => IssueMinOrderByAggregateInputSchema).optional(),
  _sum: z.lazy(() => IssueSumOrderByAggregateInputSchema).optional()
}).strict();

export const IssueScalarWhereWithAggregatesInputSchema: z.ZodType<Prisma.IssueScalarWhereWithAggregatesInput> = z.object({
  AND: z.union([ z.lazy(() => IssueScalarWhereWithAggregatesInputSchema),z.lazy(() => IssueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  OR: z.lazy(() => IssueScalarWhereWithAggregatesInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => IssueScalarWhereWithAggregatesInputSchema),z.lazy(() => IssueScalarWhereWithAggregatesInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  title: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  creator: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  priority: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  status: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
  modified: z.union([ z.lazy(() => FloatWithAggregatesFilterSchema),z.number() ]).optional(),
  kanbanorder: z.union([ z.lazy(() => StringWithAggregatesFilterSchema),z.string() ]).optional(),
}).strict();

export const CommentCreateInputSchema: z.ZodType<Prisma.CommentCreateInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  created: z.number().or(z.nan()),
  issue: z.lazy(() => IssueCreateNestedOneWithoutCommentInputSchema)
}).strict();

export const CommentUncheckedCreateInputSchema: z.ZodType<Prisma.CommentUncheckedCreateInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  issueId: z.string(),
  created: z.number().or(z.nan())
}).strict();

export const CommentUpdateInputSchema: z.ZodType<Prisma.CommentUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  issue: z.lazy(() => IssueUpdateOneRequiredWithoutCommentNestedInputSchema).optional()
}).strict();

export const CommentUncheckedUpdateInputSchema: z.ZodType<Prisma.CommentUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issueId: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const CommentCreateManyInputSchema: z.ZodType<Prisma.CommentCreateManyInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  issueId: z.string(),
  created: z.number().or(z.nan())
}).strict();

export const CommentUpdateManyMutationInputSchema: z.ZodType<Prisma.CommentUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const CommentUncheckedUpdateManyInputSchema: z.ZodType<Prisma.CommentUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issueId: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DescriptionCreateInputSchema: z.ZodType<Prisma.DescriptionCreateInput> = z.object({
  body: z.string(),
  issue: z.lazy(() => IssueCreateNestedOneWithoutDescriptionInputSchema)
}).strict();

export const DescriptionUncheckedCreateInputSchema: z.ZodType<Prisma.DescriptionUncheckedCreateInput> = z.object({
  id: z.string(),
  body: z.string()
}).strict();

export const DescriptionUpdateInputSchema: z.ZodType<Prisma.DescriptionUpdateInput> = z.object({
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  issue: z.lazy(() => IssueUpdateOneRequiredWithoutDescriptionNestedInputSchema).optional()
}).strict();

export const DescriptionUncheckedUpdateInputSchema: z.ZodType<Prisma.DescriptionUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DescriptionCreateManyInputSchema: z.ZodType<Prisma.DescriptionCreateManyInput> = z.object({
  id: z.string(),
  body: z.string()
}).strict();

export const DescriptionUpdateManyMutationInputSchema: z.ZodType<Prisma.DescriptionUpdateManyMutationInput> = z.object({
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DescriptionUncheckedUpdateManyInputSchema: z.ZodType<Prisma.DescriptionUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const IssueCreateInputSchema: z.ZodType<Prisma.IssueCreateInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number().or(z.nan()),
  modified: z.number().or(z.nan()),
  kanbanorder: z.string(),
  comment: z.lazy(() => CommentCreateNestedManyWithoutIssueInputSchema).optional(),
  description: z.lazy(() => DescriptionCreateNestedOneWithoutIssueInputSchema).optional()
}).strict();

export const IssueUncheckedCreateInputSchema: z.ZodType<Prisma.IssueUncheckedCreateInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number().or(z.nan()),
  modified: z.number().or(z.nan()),
  kanbanorder: z.string(),
  comment: z.lazy(() => CommentUncheckedCreateNestedManyWithoutIssueInputSchema).optional(),
  description: z.lazy(() => DescriptionUncheckedCreateNestedOneWithoutIssueInputSchema).optional()
}).strict();

export const IssueUpdateInputSchema: z.ZodType<Prisma.IssueUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => CommentUpdateManyWithoutIssueNestedInputSchema).optional(),
  description: z.lazy(() => DescriptionUpdateOneWithoutIssueNestedInputSchema).optional()
}).strict();

export const IssueUncheckedUpdateInputSchema: z.ZodType<Prisma.IssueUncheckedUpdateInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => CommentUncheckedUpdateManyWithoutIssueNestedInputSchema).optional(),
  description: z.lazy(() => DescriptionUncheckedUpdateOneWithoutIssueNestedInputSchema).optional()
}).strict();

export const IssueCreateManyInputSchema: z.ZodType<Prisma.IssueCreateManyInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number().or(z.nan()),
  modified: z.number().or(z.nan()),
  kanbanorder: z.string()
}).strict();

export const IssueUpdateManyMutationInputSchema: z.ZodType<Prisma.IssueUpdateManyMutationInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const IssueUncheckedUpdateManyInputSchema: z.ZodType<Prisma.IssueUncheckedUpdateManyInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const StringFilterSchema: z.ZodType<Prisma.StringFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringFilterSchema) ]).optional(),
}).strict();

export const FloatFilterSchema: z.ZodType<Prisma.FloatFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatFilterSchema) ]).optional(),
}).strict();

export const IssueRelationFilterSchema: z.ZodType<Prisma.IssueRelationFilter> = z.object({
  is: z.lazy(() => IssueWhereInputSchema).optional(),
  isNot: z.lazy(() => IssueWhereInputSchema).optional()
}).strict();

export const CommentCountOrderByAggregateInputSchema: z.ZodType<Prisma.CommentCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  issueId: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const CommentAvgOrderByAggregateInputSchema: z.ZodType<Prisma.CommentAvgOrderByAggregateInput> = z.object({
  created: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const CommentMaxOrderByAggregateInputSchema: z.ZodType<Prisma.CommentMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  issueId: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const CommentMinOrderByAggregateInputSchema: z.ZodType<Prisma.CommentMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  issueId: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const CommentSumOrderByAggregateInputSchema: z.ZodType<Prisma.CommentSumOrderByAggregateInput> = z.object({
  created: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const StringWithAggregatesFilterSchema: z.ZodType<Prisma.StringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  mode: z.lazy(() => QueryModeSchema).optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedStringFilterSchema).optional(),
  _max: z.lazy(() => NestedStringFilterSchema).optional()
}).strict();

export const FloatWithAggregatesFilterSchema: z.ZodType<Prisma.FloatWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedFloatFilterSchema).optional(),
  _min: z.lazy(() => NestedFloatFilterSchema).optional(),
  _max: z.lazy(() => NestedFloatFilterSchema).optional()
}).strict();

export const DescriptionCountOrderByAggregateInputSchema: z.ZodType<Prisma.DescriptionCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DescriptionMaxOrderByAggregateInputSchema: z.ZodType<Prisma.DescriptionMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const DescriptionMinOrderByAggregateInputSchema: z.ZodType<Prisma.DescriptionMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  body: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const CommentListRelationFilterSchema: z.ZodType<Prisma.CommentListRelationFilter> = z.object({
  every: z.lazy(() => CommentWhereInputSchema).optional(),
  some: z.lazy(() => CommentWhereInputSchema).optional(),
  none: z.lazy(() => CommentWhereInputSchema).optional()
}).strict();

export const DescriptionRelationFilterSchema: z.ZodType<Prisma.DescriptionRelationFilter> = z.object({
  is: z.lazy(() => DescriptionWhereInputSchema).optional().nullable(),
  isNot: z.lazy(() => DescriptionWhereInputSchema).optional().nullable()
}).strict();

export const CommentOrderByRelationAggregateInputSchema: z.ZodType<Prisma.CommentOrderByRelationAggregateInput> = z.object({
  _count: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueCountOrderByAggregateInputSchema: z.ZodType<Prisma.IssueCountOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueAvgOrderByAggregateInputSchema: z.ZodType<Prisma.IssueAvgOrderByAggregateInput> = z.object({
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueMaxOrderByAggregateInputSchema: z.ZodType<Prisma.IssueMaxOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueMinOrderByAggregateInputSchema: z.ZodType<Prisma.IssueMinOrderByAggregateInput> = z.object({
  id: z.lazy(() => SortOrderSchema).optional(),
  title: z.lazy(() => SortOrderSchema).optional(),
  creator: z.lazy(() => SortOrderSchema).optional(),
  priority: z.lazy(() => SortOrderSchema).optional(),
  status: z.lazy(() => SortOrderSchema).optional(),
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional(),
  kanbanorder: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueSumOrderByAggregateInputSchema: z.ZodType<Prisma.IssueSumOrderByAggregateInput> = z.object({
  created: z.lazy(() => SortOrderSchema).optional(),
  modified: z.lazy(() => SortOrderSchema).optional()
}).strict();

export const IssueCreateNestedOneWithoutCommentInputSchema: z.ZodType<Prisma.IssueCreateNestedOneWithoutCommentInput> = z.object({
  create: z.union([ z.lazy(() => IssueCreateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => IssueCreateOrConnectWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => IssueWhereUniqueInputSchema).optional()
}).strict();

export const StringFieldUpdateOperationsInputSchema: z.ZodType<Prisma.StringFieldUpdateOperationsInput> = z.object({
  set: z.string().optional()
}).strict();

export const FloatFieldUpdateOperationsInputSchema: z.ZodType<Prisma.FloatFieldUpdateOperationsInput> = z.object({
  set: z.number().optional(),
  increment: z.number().optional(),
  decrement: z.number().optional(),
  multiply: z.number().optional(),
  divide: z.number().optional()
}).strict();

export const IssueUpdateOneRequiredWithoutCommentNestedInputSchema: z.ZodType<Prisma.IssueUpdateOneRequiredWithoutCommentNestedInput> = z.object({
  create: z.union([ z.lazy(() => IssueCreateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedCreateWithoutCommentInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => IssueCreateOrConnectWithoutCommentInputSchema).optional(),
  upsert: z.lazy(() => IssueUpsertWithoutCommentInputSchema).optional(),
  connect: z.lazy(() => IssueWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => IssueUpdateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedUpdateWithoutCommentInputSchema) ]).optional(),
}).strict();

export const IssueCreateNestedOneWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueCreateNestedOneWithoutDescriptionInput> = z.object({
  create: z.union([ z.lazy(() => IssueCreateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedCreateWithoutDescriptionInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => IssueCreateOrConnectWithoutDescriptionInputSchema).optional(),
  connect: z.lazy(() => IssueWhereUniqueInputSchema).optional()
}).strict();

export const IssueUpdateOneRequiredWithoutDescriptionNestedInputSchema: z.ZodType<Prisma.IssueUpdateOneRequiredWithoutDescriptionNestedInput> = z.object({
  create: z.union([ z.lazy(() => IssueCreateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedCreateWithoutDescriptionInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => IssueCreateOrConnectWithoutDescriptionInputSchema).optional(),
  upsert: z.lazy(() => IssueUpsertWithoutDescriptionInputSchema).optional(),
  connect: z.lazy(() => IssueWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => IssueUpdateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedUpdateWithoutDescriptionInputSchema) ]).optional(),
}).strict();

export const CommentCreateNestedManyWithoutIssueInputSchema: z.ZodType<Prisma.CommentCreateNestedManyWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentCreateWithoutIssueInputSchema).array(),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => CommentCreateManyIssueInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const DescriptionCreateNestedOneWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionCreateNestedOneWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DescriptionCreateOrConnectWithoutIssueInputSchema).optional(),
  connect: z.lazy(() => DescriptionWhereUniqueInputSchema).optional()
}).strict();

export const CommentUncheckedCreateNestedManyWithoutIssueInputSchema: z.ZodType<Prisma.CommentUncheckedCreateNestedManyWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentCreateWithoutIssueInputSchema).array(),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => CommentCreateManyIssueInputEnvelopeSchema).optional(),
  connect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
}).strict();

export const DescriptionUncheckedCreateNestedOneWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionUncheckedCreateNestedOneWithoutIssueInput> = z.object({
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DescriptionCreateOrConnectWithoutIssueInputSchema).optional(),
  connect: z.lazy(() => DescriptionWhereUniqueInputSchema).optional()
}).strict();

export const CommentUpdateManyWithoutIssueNestedInputSchema: z.ZodType<Prisma.CommentUpdateManyWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentCreateWithoutIssueInputSchema).array(),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => CommentUpsertWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => CommentUpsertWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => CommentCreateManyIssueInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => CommentUpdateWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => CommentUpdateWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => CommentUpdateManyWithWhereWithoutIssueInputSchema),z.lazy(() => CommentUpdateManyWithWhereWithoutIssueInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => CommentScalarWhereInputSchema),z.lazy(() => CommentScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const DescriptionUpdateOneWithoutIssueNestedInputSchema: z.ZodType<Prisma.DescriptionUpdateOneWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DescriptionCreateOrConnectWithoutIssueInputSchema).optional(),
  upsert: z.lazy(() => DescriptionUpsertWithoutIssueInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => DescriptionWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => DescriptionUpdateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedUpdateWithoutIssueInputSchema) ]).optional(),
}).strict();

export const CommentUncheckedUpdateManyWithoutIssueNestedInputSchema: z.ZodType<Prisma.CommentUncheckedUpdateManyWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentCreateWithoutIssueInputSchema).array(),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema).array() ]).optional(),
  connectOrCreate: z.union([ z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema),z.lazy(() => CommentCreateOrConnectWithoutIssueInputSchema).array() ]).optional(),
  upsert: z.union([ z.lazy(() => CommentUpsertWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => CommentUpsertWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  createMany: z.lazy(() => CommentCreateManyIssueInputEnvelopeSchema).optional(),
  set: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  disconnect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  delete: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  connect: z.union([ z.lazy(() => CommentWhereUniqueInputSchema),z.lazy(() => CommentWhereUniqueInputSchema).array() ]).optional(),
  update: z.union([ z.lazy(() => CommentUpdateWithWhereUniqueWithoutIssueInputSchema),z.lazy(() => CommentUpdateWithWhereUniqueWithoutIssueInputSchema).array() ]).optional(),
  updateMany: z.union([ z.lazy(() => CommentUpdateManyWithWhereWithoutIssueInputSchema),z.lazy(() => CommentUpdateManyWithWhereWithoutIssueInputSchema).array() ]).optional(),
  deleteMany: z.union([ z.lazy(() => CommentScalarWhereInputSchema),z.lazy(() => CommentScalarWhereInputSchema).array() ]).optional(),
}).strict();

export const DescriptionUncheckedUpdateOneWithoutIssueNestedInputSchema: z.ZodType<Prisma.DescriptionUncheckedUpdateOneWithoutIssueNestedInput> = z.object({
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]).optional(),
  connectOrCreate: z.lazy(() => DescriptionCreateOrConnectWithoutIssueInputSchema).optional(),
  upsert: z.lazy(() => DescriptionUpsertWithoutIssueInputSchema).optional(),
  disconnect: z.boolean().optional(),
  delete: z.boolean().optional(),
  connect: z.lazy(() => DescriptionWhereUniqueInputSchema).optional(),
  update: z.union([ z.lazy(() => DescriptionUpdateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedUpdateWithoutIssueInputSchema) ]).optional(),
}).strict();

export const NestedStringFilterSchema: z.ZodType<Prisma.NestedStringFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringFilterSchema) ]).optional(),
}).strict();

export const NestedFloatFilterSchema: z.ZodType<Prisma.NestedFloatFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatFilterSchema) ]).optional(),
}).strict();

export const NestedStringWithAggregatesFilterSchema: z.ZodType<Prisma.NestedStringWithAggregatesFilter> = z.object({
  equals: z.string().optional(),
  in: z.string().array().optional(),
  notIn: z.string().array().optional(),
  lt: z.string().optional(),
  lte: z.string().optional(),
  gt: z.string().optional(),
  gte: z.string().optional(),
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  not: z.union([ z.string(),z.lazy(() => NestedStringWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _min: z.lazy(() => NestedStringFilterSchema).optional(),
  _max: z.lazy(() => NestedStringFilterSchema).optional()
}).strict();

export const NestedIntFilterSchema: z.ZodType<Prisma.NestedIntFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedIntFilterSchema) ]).optional(),
}).strict();

export const NestedFloatWithAggregatesFilterSchema: z.ZodType<Prisma.NestedFloatWithAggregatesFilter> = z.object({
  equals: z.number().optional(),
  in: z.number().array().optional(),
  notIn: z.number().array().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  not: z.union([ z.number(),z.lazy(() => NestedFloatWithAggregatesFilterSchema) ]).optional(),
  _count: z.lazy(() => NestedIntFilterSchema).optional(),
  _avg: z.lazy(() => NestedFloatFilterSchema).optional(),
  _sum: z.lazy(() => NestedFloatFilterSchema).optional(),
  _min: z.lazy(() => NestedFloatFilterSchema).optional(),
  _max: z.lazy(() => NestedFloatFilterSchema).optional()
}).strict();

export const IssueCreateWithoutCommentInputSchema: z.ZodType<Prisma.IssueCreateWithoutCommentInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number(),
  modified: z.number(),
  kanbanorder: z.string(),
  description: z.lazy(() => DescriptionCreateNestedOneWithoutIssueInputSchema).optional()
}).strict();

export const IssueUncheckedCreateWithoutCommentInputSchema: z.ZodType<Prisma.IssueUncheckedCreateWithoutCommentInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number(),
  modified: z.number(),
  kanbanorder: z.string(),
  description: z.lazy(() => DescriptionUncheckedCreateNestedOneWithoutIssueInputSchema).optional()
}).strict();

export const IssueCreateOrConnectWithoutCommentInputSchema: z.ZodType<Prisma.IssueCreateOrConnectWithoutCommentInput> = z.object({
  where: z.lazy(() => IssueWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => IssueCreateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const IssueUpsertWithoutCommentInputSchema: z.ZodType<Prisma.IssueUpsertWithoutCommentInput> = z.object({
  update: z.union([ z.lazy(() => IssueUpdateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedUpdateWithoutCommentInputSchema) ]),
  create: z.union([ z.lazy(() => IssueCreateWithoutCommentInputSchema),z.lazy(() => IssueUncheckedCreateWithoutCommentInputSchema) ]),
}).strict();

export const IssueUpdateWithoutCommentInputSchema: z.ZodType<Prisma.IssueUpdateWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.lazy(() => DescriptionUpdateOneWithoutIssueNestedInputSchema).optional()
}).strict();

export const IssueUncheckedUpdateWithoutCommentInputSchema: z.ZodType<Prisma.IssueUncheckedUpdateWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  description: z.lazy(() => DescriptionUncheckedUpdateOneWithoutIssueNestedInputSchema).optional()
}).strict();

export const IssueCreateWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueCreateWithoutDescriptionInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number(),
  modified: z.number(),
  kanbanorder: z.string(),
  comment: z.lazy(() => CommentCreateNestedManyWithoutIssueInputSchema).optional()
}).strict();

export const IssueUncheckedCreateWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueUncheckedCreateWithoutDescriptionInput> = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  priority: z.string(),
  status: z.string(),
  created: z.number(),
  modified: z.number(),
  kanbanorder: z.string(),
  comment: z.lazy(() => CommentUncheckedCreateNestedManyWithoutIssueInputSchema).optional()
}).strict();

export const IssueCreateOrConnectWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueCreateOrConnectWithoutDescriptionInput> = z.object({
  where: z.lazy(() => IssueWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => IssueCreateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedCreateWithoutDescriptionInputSchema) ]),
}).strict();

export const IssueUpsertWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueUpsertWithoutDescriptionInput> = z.object({
  update: z.union([ z.lazy(() => IssueUpdateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedUpdateWithoutDescriptionInputSchema) ]),
  create: z.union([ z.lazy(() => IssueCreateWithoutDescriptionInputSchema),z.lazy(() => IssueUncheckedCreateWithoutDescriptionInputSchema) ]),
}).strict();

export const IssueUpdateWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueUpdateWithoutDescriptionInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => CommentUpdateManyWithoutIssueNestedInputSchema).optional()
}).strict();

export const IssueUncheckedUpdateWithoutDescriptionInputSchema: z.ZodType<Prisma.IssueUncheckedUpdateWithoutDescriptionInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  title: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  priority: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  status: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  modified: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
  kanbanorder: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  comment: z.lazy(() => CommentUncheckedUpdateManyWithoutIssueNestedInputSchema).optional()
}).strict();

export const CommentCreateWithoutIssueInputSchema: z.ZodType<Prisma.CommentCreateWithoutIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  created: z.number()
}).strict();

export const CommentUncheckedCreateWithoutIssueInputSchema: z.ZodType<Prisma.CommentUncheckedCreateWithoutIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  created: z.number()
}).strict();

export const CommentCreateOrConnectWithoutIssueInputSchema: z.ZodType<Prisma.CommentCreateOrConnectWithoutIssueInput> = z.object({
  where: z.lazy(() => CommentWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const CommentCreateManyIssueInputEnvelopeSchema: z.ZodType<Prisma.CommentCreateManyIssueInputEnvelope> = z.object({
  data: z.lazy(() => CommentCreateManyIssueInputSchema).array(),
  skipDuplicates: z.boolean().optional()
}).strict();

export const DescriptionCreateWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionCreateWithoutIssueInput> = z.object({
  body: z.string()
}).strict();

export const DescriptionUncheckedCreateWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionUncheckedCreateWithoutIssueInput> = z.object({
  body: z.string()
}).strict();

export const DescriptionCreateOrConnectWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionCreateOrConnectWithoutIssueInput> = z.object({
  where: z.lazy(() => DescriptionWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const CommentUpsertWithWhereUniqueWithoutIssueInputSchema: z.ZodType<Prisma.CommentUpsertWithWhereUniqueWithoutIssueInput> = z.object({
  where: z.lazy(() => CommentWhereUniqueInputSchema),
  update: z.union([ z.lazy(() => CommentUpdateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedUpdateWithoutIssueInputSchema) ]),
  create: z.union([ z.lazy(() => CommentCreateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const CommentUpdateWithWhereUniqueWithoutIssueInputSchema: z.ZodType<Prisma.CommentUpdateWithWhereUniqueWithoutIssueInput> = z.object({
  where: z.lazy(() => CommentWhereUniqueInputSchema),
  data: z.union([ z.lazy(() => CommentUpdateWithoutIssueInputSchema),z.lazy(() => CommentUncheckedUpdateWithoutIssueInputSchema) ]),
}).strict();

export const CommentUpdateManyWithWhereWithoutIssueInputSchema: z.ZodType<Prisma.CommentUpdateManyWithWhereWithoutIssueInput> = z.object({
  where: z.lazy(() => CommentScalarWhereInputSchema),
  data: z.union([ z.lazy(() => CommentUpdateManyMutationInputSchema),z.lazy(() => CommentUncheckedUpdateManyWithoutCommentInputSchema) ]),
}).strict();

export const CommentScalarWhereInputSchema: z.ZodType<Prisma.CommentScalarWhereInput> = z.object({
  AND: z.union([ z.lazy(() => CommentScalarWhereInputSchema),z.lazy(() => CommentScalarWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => CommentScalarWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => CommentScalarWhereInputSchema),z.lazy(() => CommentScalarWhereInputSchema).array() ]).optional(),
  id: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  body: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  creator: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  issueId: z.union([ z.lazy(() => StringFilterSchema),z.string() ]).optional(),
  created: z.union([ z.lazy(() => FloatFilterSchema),z.number() ]).optional(),
}).strict();

export const DescriptionUpsertWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionUpsertWithoutIssueInput> = z.object({
  update: z.union([ z.lazy(() => DescriptionUpdateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedUpdateWithoutIssueInputSchema) ]),
  create: z.union([ z.lazy(() => DescriptionCreateWithoutIssueInputSchema),z.lazy(() => DescriptionUncheckedCreateWithoutIssueInputSchema) ]),
}).strict();

export const DescriptionUpdateWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionUpdateWithoutIssueInput> = z.object({
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const DescriptionUncheckedUpdateWithoutIssueInputSchema: z.ZodType<Prisma.DescriptionUncheckedUpdateWithoutIssueInput> = z.object({
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const CommentCreateManyIssueInputSchema: z.ZodType<Prisma.CommentCreateManyIssueInput> = z.object({
  id: z.string(),
  body: z.string(),
  creator: z.string(),
  created: z.number().or(z.nan())
}).strict();

export const CommentUpdateWithoutIssueInputSchema: z.ZodType<Prisma.CommentUpdateWithoutIssueInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const CommentUncheckedUpdateWithoutIssueInputSchema: z.ZodType<Prisma.CommentUncheckedUpdateWithoutIssueInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number(),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

export const CommentUncheckedUpdateManyWithoutCommentInputSchema: z.ZodType<Prisma.CommentUncheckedUpdateManyWithoutCommentInput> = z.object({
  id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  body: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  creator: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created: z.union([ z.number().or(z.nan()),z.lazy(() => FloatFieldUpdateOperationsInputSchema) ]).optional(),
}).strict();

/////////////////////////////////////////
// ARGS
/////////////////////////////////////////

export const CommentFindFirstArgsSchema: z.ZodType<Prisma.CommentFindFirstArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereInputSchema.optional(),
  orderBy: z.union([ CommentOrderByWithRelationInputSchema.array(),CommentOrderByWithRelationInputSchema ]).optional(),
  cursor: CommentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.CommentFindFirstArgs>

export const CommentFindFirstOrThrowArgsSchema: z.ZodType<Prisma.CommentFindFirstOrThrowArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereInputSchema.optional(),
  orderBy: z.union([ CommentOrderByWithRelationInputSchema.array(),CommentOrderByWithRelationInputSchema ]).optional(),
  cursor: CommentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.CommentFindFirstOrThrowArgs>

export const CommentFindManyArgsSchema: z.ZodType<Prisma.CommentFindManyArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereInputSchema.optional(),
  orderBy: z.union([ CommentOrderByWithRelationInputSchema.array(),CommentOrderByWithRelationInputSchema ]).optional(),
  cursor: CommentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: CommentScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.CommentFindManyArgs>

export const CommentAggregateArgsSchema: z.ZodType<Prisma.CommentAggregateArgs> = z.object({
  where: CommentWhereInputSchema.optional(),
  orderBy: z.union([ CommentOrderByWithRelationInputSchema.array(),CommentOrderByWithRelationInputSchema ]).optional(),
  cursor: CommentWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.CommentAggregateArgs>

export const CommentGroupByArgsSchema: z.ZodType<Prisma.CommentGroupByArgs> = z.object({
  where: CommentWhereInputSchema.optional(),
  orderBy: z.union([ CommentOrderByWithAggregationInputSchema.array(),CommentOrderByWithAggregationInputSchema ]).optional(),
  by: CommentScalarFieldEnumSchema.array(),
  having: CommentScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.CommentGroupByArgs>

export const CommentFindUniqueArgsSchema: z.ZodType<Prisma.CommentFindUniqueArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.CommentFindUniqueArgs>

export const CommentFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.CommentFindUniqueOrThrowArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.CommentFindUniqueOrThrowArgs>

export const DescriptionFindFirstArgsSchema: z.ZodType<Prisma.DescriptionFindFirstArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereInputSchema.optional(),
  orderBy: z.union([ DescriptionOrderByWithRelationInputSchema.array(),DescriptionOrderByWithRelationInputSchema ]).optional(),
  cursor: DescriptionWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DescriptionScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.DescriptionFindFirstArgs>

export const DescriptionFindFirstOrThrowArgsSchema: z.ZodType<Prisma.DescriptionFindFirstOrThrowArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereInputSchema.optional(),
  orderBy: z.union([ DescriptionOrderByWithRelationInputSchema.array(),DescriptionOrderByWithRelationInputSchema ]).optional(),
  cursor: DescriptionWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DescriptionScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.DescriptionFindFirstOrThrowArgs>

export const DescriptionFindManyArgsSchema: z.ZodType<Prisma.DescriptionFindManyArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereInputSchema.optional(),
  orderBy: z.union([ DescriptionOrderByWithRelationInputSchema.array(),DescriptionOrderByWithRelationInputSchema ]).optional(),
  cursor: DescriptionWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: DescriptionScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.DescriptionFindManyArgs>

export const DescriptionAggregateArgsSchema: z.ZodType<Prisma.DescriptionAggregateArgs> = z.object({
  where: DescriptionWhereInputSchema.optional(),
  orderBy: z.union([ DescriptionOrderByWithRelationInputSchema.array(),DescriptionOrderByWithRelationInputSchema ]).optional(),
  cursor: DescriptionWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.DescriptionAggregateArgs>

export const DescriptionGroupByArgsSchema: z.ZodType<Prisma.DescriptionGroupByArgs> = z.object({
  where: DescriptionWhereInputSchema.optional(),
  orderBy: z.union([ DescriptionOrderByWithAggregationInputSchema.array(),DescriptionOrderByWithAggregationInputSchema ]).optional(),
  by: DescriptionScalarFieldEnumSchema.array(),
  having: DescriptionScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.DescriptionGroupByArgs>

export const DescriptionFindUniqueArgsSchema: z.ZodType<Prisma.DescriptionFindUniqueArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.DescriptionFindUniqueArgs>

export const DescriptionFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.DescriptionFindUniqueOrThrowArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.DescriptionFindUniqueOrThrowArgs>

export const IssueFindFirstArgsSchema: z.ZodType<Prisma.IssueFindFirstArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereInputSchema.optional(),
  orderBy: z.union([ IssueOrderByWithRelationInputSchema.array(),IssueOrderByWithRelationInputSchema ]).optional(),
  cursor: IssueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.IssueFindFirstArgs>

export const IssueFindFirstOrThrowArgsSchema: z.ZodType<Prisma.IssueFindFirstOrThrowArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereInputSchema.optional(),
  orderBy: z.union([ IssueOrderByWithRelationInputSchema.array(),IssueOrderByWithRelationInputSchema ]).optional(),
  cursor: IssueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.IssueFindFirstOrThrowArgs>

export const IssueFindManyArgsSchema: z.ZodType<Prisma.IssueFindManyArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereInputSchema.optional(),
  orderBy: z.union([ IssueOrderByWithRelationInputSchema.array(),IssueOrderByWithRelationInputSchema ]).optional(),
  cursor: IssueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: IssueScalarFieldEnumSchema.array().optional(),
}).strict() as z.ZodType<Prisma.IssueFindManyArgs>

export const IssueAggregateArgsSchema: z.ZodType<Prisma.IssueAggregateArgs> = z.object({
  where: IssueWhereInputSchema.optional(),
  orderBy: z.union([ IssueOrderByWithRelationInputSchema.array(),IssueOrderByWithRelationInputSchema ]).optional(),
  cursor: IssueWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.IssueAggregateArgs>

export const IssueGroupByArgsSchema: z.ZodType<Prisma.IssueGroupByArgs> = z.object({
  where: IssueWhereInputSchema.optional(),
  orderBy: z.union([ IssueOrderByWithAggregationInputSchema.array(),IssueOrderByWithAggregationInputSchema ]).optional(),
  by: IssueScalarFieldEnumSchema.array(),
  having: IssueScalarWhereWithAggregatesInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
}).strict() as z.ZodType<Prisma.IssueGroupByArgs>

export const IssueFindUniqueArgsSchema: z.ZodType<Prisma.IssueFindUniqueArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.IssueFindUniqueArgs>

export const IssueFindUniqueOrThrowArgsSchema: z.ZodType<Prisma.IssueFindUniqueOrThrowArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.IssueFindUniqueOrThrowArgs>

export const CommentCreateArgsSchema: z.ZodType<Prisma.CommentCreateArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  data: z.union([ CommentCreateInputSchema,CommentUncheckedCreateInputSchema ]),
}).strict() as z.ZodType<Prisma.CommentCreateArgs>

export const CommentUpsertArgsSchema: z.ZodType<Prisma.CommentUpsertArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereUniqueInputSchema,
  create: z.union([ CommentCreateInputSchema,CommentUncheckedCreateInputSchema ]),
  update: z.union([ CommentUpdateInputSchema,CommentUncheckedUpdateInputSchema ]),
}).strict() as z.ZodType<Prisma.CommentUpsertArgs>

export const CommentCreateManyArgsSchema: z.ZodType<Prisma.CommentCreateManyArgs> = z.object({
  data: CommentCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() as z.ZodType<Prisma.CommentCreateManyArgs>

export const CommentDeleteArgsSchema: z.ZodType<Prisma.CommentDeleteArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  where: CommentWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.CommentDeleteArgs>

export const CommentUpdateArgsSchema: z.ZodType<Prisma.CommentUpdateArgs> = z.object({
  select: CommentSelectSchema.optional(),
  include: CommentIncludeSchema.optional(),
  data: z.union([ CommentUpdateInputSchema,CommentUncheckedUpdateInputSchema ]),
  where: CommentWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.CommentUpdateArgs>

export const CommentUpdateManyArgsSchema: z.ZodType<Prisma.CommentUpdateManyArgs> = z.object({
  data: z.union([ CommentUpdateManyMutationInputSchema,CommentUncheckedUpdateManyInputSchema ]),
  where: CommentWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.CommentUpdateManyArgs>

export const CommentDeleteManyArgsSchema: z.ZodType<Prisma.CommentDeleteManyArgs> = z.object({
  where: CommentWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.CommentDeleteManyArgs>

export const DescriptionCreateArgsSchema: z.ZodType<Prisma.DescriptionCreateArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  data: z.union([ DescriptionCreateInputSchema,DescriptionUncheckedCreateInputSchema ]),
}).strict() as z.ZodType<Prisma.DescriptionCreateArgs>

export const DescriptionUpsertArgsSchema: z.ZodType<Prisma.DescriptionUpsertArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereUniqueInputSchema,
  create: z.union([ DescriptionCreateInputSchema,DescriptionUncheckedCreateInputSchema ]),
  update: z.union([ DescriptionUpdateInputSchema,DescriptionUncheckedUpdateInputSchema ]),
}).strict() as z.ZodType<Prisma.DescriptionUpsertArgs>

export const DescriptionCreateManyArgsSchema: z.ZodType<Prisma.DescriptionCreateManyArgs> = z.object({
  data: DescriptionCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() as z.ZodType<Prisma.DescriptionCreateManyArgs>

export const DescriptionDeleteArgsSchema: z.ZodType<Prisma.DescriptionDeleteArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  where: DescriptionWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.DescriptionDeleteArgs>

export const DescriptionUpdateArgsSchema: z.ZodType<Prisma.DescriptionUpdateArgs> = z.object({
  select: DescriptionSelectSchema.optional(),
  include: DescriptionIncludeSchema.optional(),
  data: z.union([ DescriptionUpdateInputSchema,DescriptionUncheckedUpdateInputSchema ]),
  where: DescriptionWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.DescriptionUpdateArgs>

export const DescriptionUpdateManyArgsSchema: z.ZodType<Prisma.DescriptionUpdateManyArgs> = z.object({
  data: z.union([ DescriptionUpdateManyMutationInputSchema,DescriptionUncheckedUpdateManyInputSchema ]),
  where: DescriptionWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.DescriptionUpdateManyArgs>

export const DescriptionDeleteManyArgsSchema: z.ZodType<Prisma.DescriptionDeleteManyArgs> = z.object({
  where: DescriptionWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.DescriptionDeleteManyArgs>

export const IssueCreateArgsSchema: z.ZodType<Prisma.IssueCreateArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  data: z.union([ IssueCreateInputSchema,IssueUncheckedCreateInputSchema ]),
}).strict() as z.ZodType<Prisma.IssueCreateArgs>

export const IssueUpsertArgsSchema: z.ZodType<Prisma.IssueUpsertArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereUniqueInputSchema,
  create: z.union([ IssueCreateInputSchema,IssueUncheckedCreateInputSchema ]),
  update: z.union([ IssueUpdateInputSchema,IssueUncheckedUpdateInputSchema ]),
}).strict() as z.ZodType<Prisma.IssueUpsertArgs>

export const IssueCreateManyArgsSchema: z.ZodType<Prisma.IssueCreateManyArgs> = z.object({
  data: IssueCreateManyInputSchema.array(),
  skipDuplicates: z.boolean().optional(),
}).strict() as z.ZodType<Prisma.IssueCreateManyArgs>

export const IssueDeleteArgsSchema: z.ZodType<Prisma.IssueDeleteArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  where: IssueWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.IssueDeleteArgs>

export const IssueUpdateArgsSchema: z.ZodType<Prisma.IssueUpdateArgs> = z.object({
  select: IssueSelectSchema.optional(),
  include: IssueIncludeSchema.optional(),
  data: z.union([ IssueUpdateInputSchema,IssueUncheckedUpdateInputSchema ]),
  where: IssueWhereUniqueInputSchema,
}).strict() as z.ZodType<Prisma.IssueUpdateArgs>

export const IssueUpdateManyArgsSchema: z.ZodType<Prisma.IssueUpdateManyArgs> = z.object({
  data: z.union([ IssueUpdateManyMutationInputSchema,IssueUncheckedUpdateManyInputSchema ]),
  where: IssueWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.IssueUpdateManyArgs>

export const IssueDeleteManyArgsSchema: z.ZodType<Prisma.IssueDeleteManyArgs> = z.object({
  where: IssueWhereInputSchema.optional(),
}).strict() as z.ZodType<Prisma.IssueDeleteManyArgs>

// @ts-ignore
interface CommentGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.CommentArgs
  readonly type: Prisma.CommentGetPayload<this['_A']>
}

// @ts-ignore
interface DescriptionGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.DescriptionArgs
  readonly type: Prisma.DescriptionGetPayload<this['_A']>
}

// @ts-ignore
interface IssueGetPayload extends HKT {
  readonly _A?: boolean | null | undefined | Prisma.IssueArgs
  readonly type: Prisma.IssueGetPayload<this['_A']>
}

export const tableSchemas = {
  comment: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "body",
        "TEXT"
      ],
      [
        "creator",
        "TEXT"
      ],
      [
        "issueId",
        "TEXT"
      ],
      [
        "created",
        "FLOAT8"
      ]
    ]),
    relations: [
      new Relation("issue", "issueId", "id", "issue", "CommentToIssue", "one"),
    ],
    modelSchema: (CommentCreateInputSchema as any)
      .partial()
      .or((CommentUncheckedCreateInputSchema as any).partial()),
    createSchema: CommentCreateArgsSchema,
    createManySchema: CommentCreateManyArgsSchema,
    findUniqueSchema: CommentFindUniqueArgsSchema,
    findSchema: CommentFindFirstArgsSchema,
    updateSchema: CommentUpdateArgsSchema,
    updateManySchema: CommentUpdateManyArgsSchema,
    upsertSchema: CommentUpsertArgsSchema,
    deleteSchema: CommentDeleteArgsSchema,
    deleteManySchema: CommentDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof CommentCreateInputSchema>,
    Prisma.CommentCreateArgs['data'],
    Prisma.CommentUpdateArgs['data'],
    Prisma.CommentFindFirstArgs['select'],
    Prisma.CommentFindFirstArgs['where'],
    Prisma.CommentFindUniqueArgs['where'],
    Omit<Prisma.CommentInclude, '_count'>,
    Prisma.CommentFindFirstArgs['orderBy'],
    Prisma.CommentScalarFieldEnum,
    CommentGetPayload
  >,
  description: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "body",
        "TEXT"
      ]
    ]),
    relations: [
      new Relation("issue", "id", "id", "issue", "DescriptionToIssue", "one"),
    ],
    modelSchema: (DescriptionCreateInputSchema as any)
      .partial()
      .or((DescriptionUncheckedCreateInputSchema as any).partial()),
    createSchema: DescriptionCreateArgsSchema,
    createManySchema: DescriptionCreateManyArgsSchema,
    findUniqueSchema: DescriptionFindUniqueArgsSchema,
    findSchema: DescriptionFindFirstArgsSchema,
    updateSchema: DescriptionUpdateArgsSchema,
    updateManySchema: DescriptionUpdateManyArgsSchema,
    upsertSchema: DescriptionUpsertArgsSchema,
    deleteSchema: DescriptionDeleteArgsSchema,
    deleteManySchema: DescriptionDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof DescriptionCreateInputSchema>,
    Prisma.DescriptionCreateArgs['data'],
    Prisma.DescriptionUpdateArgs['data'],
    Prisma.DescriptionFindFirstArgs['select'],
    Prisma.DescriptionFindFirstArgs['where'],
    Prisma.DescriptionFindUniqueArgs['where'],
    Omit<Prisma.DescriptionInclude, '_count'>,
    Prisma.DescriptionFindFirstArgs['orderBy'],
    Prisma.DescriptionScalarFieldEnum,
    DescriptionGetPayload
  >,
  issue: {
    fields: new Map([
      [
        "id",
        "TEXT"
      ],
      [
        "title",
        "TEXT"
      ],
      [
        "creator",
        "TEXT"
      ],
      [
        "priority",
        "TEXT"
      ],
      [
        "status",
        "TEXT"
      ],
      [
        "created",
        "FLOAT8"
      ],
      [
        "modified",
        "FLOAT8"
      ],
      [
        "kanbanorder",
        "TEXT"
      ]
    ]),
    relations: [
      new Relation("comment", "", "", "comment", "CommentToIssue", "many"),
      new Relation("description", "", "", "description", "DescriptionToIssue", "one"),
    ],
    modelSchema: (IssueCreateInputSchema as any)
      .partial()
      .or((IssueUncheckedCreateInputSchema as any).partial()),
    createSchema: IssueCreateArgsSchema,
    createManySchema: IssueCreateManyArgsSchema,
    findUniqueSchema: IssueFindUniqueArgsSchema,
    findSchema: IssueFindFirstArgsSchema,
    updateSchema: IssueUpdateArgsSchema,
    updateManySchema: IssueUpdateManyArgsSchema,
    upsertSchema: IssueUpsertArgsSchema,
    deleteSchema: IssueDeleteArgsSchema,
    deleteManySchema: IssueDeleteManyArgsSchema
  } as TableSchema<
    z.infer<typeof IssueCreateInputSchema>,
    Prisma.IssueCreateArgs['data'],
    Prisma.IssueUpdateArgs['data'],
    Prisma.IssueFindFirstArgs['select'],
    Prisma.IssueFindFirstArgs['where'],
    Prisma.IssueFindUniqueArgs['where'],
    Omit<Prisma.IssueInclude, '_count'>,
    Prisma.IssueFindFirstArgs['orderBy'],
    Prisma.IssueScalarFieldEnum,
    IssueGetPayload
  >,
}

export const schema = new DbSchema(tableSchemas, migrations)
export type Electric = ElectricClient<typeof schema>
