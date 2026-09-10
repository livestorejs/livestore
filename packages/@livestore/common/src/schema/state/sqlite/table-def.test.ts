import { TestSchema } from 'effect/testing'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type Brand,
  Effect,
  Option,
  Result,
  Schema,
  SchemaAST,
  SchemaIssue,
  SchemaTransformation,
} from '@livestore/utils/effect'

import { State } from '../../mod.ts'

describe('table function overloads', () => {
  it('should extract table name from title annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotate({ title: 'todos' })

    const todosTable = State.SQLite.table({
      schema: TodoSchema,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
  })

  it('should extract table name from identifier annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotate({ identifier: 'TodoItem' })

    const todosTable = State.SQLite.table({ schema: TodoSchema })

    expect(todosTable.sqliteDef.name).toBe('TodoItem')
  })

  it('should prefer title over identifier annotation', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }).annotate({
      title: 'todos',
      identifier: 'TodoItem',
    })

    const todosTable = State.SQLite.table({ schema: TodoSchema })

    expect(todosTable.sqliteDef.name).toBe('todos')
  })

  it('should throw when schema has no name, title, or identifier', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    })

    expect(() => State.SQLite.table({ schema: TodoSchema })).toThrow(
      'When using schema without explicit name, the schema must have a title or identifier annotation',
    )
  })

  it('should work with columns parameter', async () => {
    const todosTable = State.SQLite.table({
      name: 'todos',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        text: State.SQLite.text({ default: '' }),
        completed: State.SQLite.boolean({ default: false }),
        optionalBoolean: State.SQLite.boolean({ default: false, nullable: true }),
        optionalComplex: State.SQLite.json({
          nullable: true,
          schema: Schema.Struct({ color: Schema.String }).pipe(Schema.UndefinedOr),
        }),
      },
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
    expect(todosTable.sqliteDef.columns).toHaveProperty('optionalComplex')

    expect(todosTable.sqliteDef.columns.optionalBoolean.nullable).toBe(true)
    expect(Schema.encodeSync(todosTable.sqliteDef.columns.optionalBoolean.schema)(false)).toBe(0)

    expect(todosTable.sqliteDef.columns.optionalComplex.nullable).toBe(true)

    const asserts = new TestSchema.Asserts(todosTable.rowSchema)
    await asserts.decoding().succeed(
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: 1,
        optionalBoolean: null,
        optionalComplex: JSON.stringify({ color: 'red' }),
      },
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: true,
        optionalBoolean: null,
        optionalComplex: { color: 'red' },
      },
    )
    await asserts.decoding().succeed(
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: 0,
        optionalBoolean: null,
        optionalComplex: null,
      },
      {
        id: 'todo-1',
        text: 'Buy milk',
        completed: false,
        optionalBoolean: null,
        optionalComplex: null,
      },
    )
  })

  it('should allow explicit first two generic arguments without options generic', () => {
    const columns = {
      id: State.SQLite.text({ primaryKey: true }),
      text: State.SQLite.text({ default: '' }),
    }

    const todosTable = State.SQLite.table<'todos', typeof columns>({
      name: 'todos',
      columns,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
  })

  it('should work with schema parameter', () => {
    const TodoSchema = Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    })

    const todosTable = State.SQLite.table({
      name: 'todos',
      schema: TodoSchema,
    })

    expect(todosTable.sqliteDef.name).toBe('todos')
    expect(todosTable.sqliteDef.columns).toHaveProperty('id')
    expect(todosTable.sqliteDef.columns).toHaveProperty('text')
    expect(todosTable.sqliteDef.columns).toHaveProperty('completed')
  })

  it('should work with single column', () => {
    const simpleTable = State.SQLite.table({
      name: 'simple',
      columns: State.SQLite.text({ primaryKey: true }),
    })

    expect(simpleTable.sqliteDef.name).toBe('simple')
    expect(simpleTable.sqliteDef.columns).toHaveProperty('value')
    expect(simpleTable.sqliteDef.columns.value.primaryKey).toBe(true)
  })

  it('should handle optional fields in schema', () => {
    const UserSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.optional(Schema.String),
    })

    const userTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    expect(userTable.sqliteDef.columns.id.nullable).toBe(false)
    expect(userTable.sqliteDef.columns.name.nullable).toBe(false)
    expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
  })

  it('keeps a date codec so the column round-trips through its encoded form', () => {
    const StampSchema = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      createdAt: Schema.DateFromString,
      seenAt: Schema.DateFromMillis,
      bornAt: Schema.Date,
      deletedAt: Schema.NullOr(Schema.DateFromString),
      archivedAt: Schema.optional(Schema.DateFromString),
    })

    const stamps = State.SQLite.table({ name: 'stamps', schema: StampSchema })
    const { columns } = stamps.sqliteDef
    const date = new Date('2026-01-02T03:04:05.678Z')
    const roundTrip = (column: { schema: Schema.Codec<any, any> }, value: unknown) =>
      Schema.decodeUnknownSync(column.schema)(Schema.encodeUnknownSync(column.schema)(value))

    expect(columns.createdAt.columnType).toBe('text')
    expect(Schema.encodeUnknownSync(columns.createdAt.schema)(date)).toBe(date.toISOString())
    expect(roundTrip(columns.createdAt, date)).toEqual(date)

    expect(columns.seenAt.columnType).toBe('integer')
    expect(Schema.encodeUnknownSync(columns.seenAt.schema)(date)).toBe(date.getTime())
    expect(roundTrip(columns.seenAt, date)).toEqual(date)

    expect(columns.bornAt.columnType).toBe('text')
    expect(Schema.encodeUnknownSync(columns.bornAt.schema)(date)).toBe(date.toISOString())
    expect(roundTrip(columns.bornAt, date)).toEqual(date)

    expect(columns.deletedAt.nullable).toBe(true)
    expect(roundTrip(columns.deletedAt, date)).toEqual(date)
    expect(roundTrip(columns.deletedAt, null)).toBeNull()

    expect(columns.archivedAt.nullable).toBe(true)
    expect(roundTrip(columns.archivedAt, date)).toEqual(date)

    // The row schema is the struct of those field codecs, so a SQLite row decodes in one step
    expectTypeOf(stamps.rowSchema.fields.createdAt).toEqualTypeOf<Schema.DateFromString>()
    expectTypeOf(stamps.rowSchema.fields.seenAt).toEqualTypeOf<Schema.DateFromMillis>()
    expectTypeOf<(typeof stamps.Type)['bornAt']>().toEqualTypeOf<Date>()
    expectTypeOf<(typeof stamps.Encoded)['bornAt']>().toEqualTypeOf<string>()
    expectTypeOf<(typeof stamps.Type)['archivedAt']>().toEqualTypeOf<Date | null>()
    expect(
      Schema.decodeUnknownSync(stamps.rowSchema)({
        id: '1',
        createdAt: date.toISOString(),
        seenAt: date.getTime(),
        bornAt: date.toISOString(),
        deletedAt: null,
        archivedAt: null,
      }),
    ).toEqual({ id: '1', createdAt: date, seenAt: date, bornAt: date, deletedAt: null, archivedAt: null })
  })

  it('stores a codec field in its encoded form, like getColumnDefForSchema does', () => {
    const CounterSchema = Schema.Struct({
      id: Schema.String,
      count: Schema.FiniteFromString,
    })

    const { columns } = State.SQLite.table({ name: 'counters', schema: CounterSchema }).sqliteDef

    expect(columns.count.columnType).toBe('text')
    expect(Schema.encodeUnknownSync(columns.count.schema)(42)).toBe('42')
    expect(Schema.decodeUnknownSync(columns.count.schema)('42')).toBe(42)
  })

  it('tracks column defaults at the type level so insert() can omit them', () => {
    const settings = State.SQLite.table({
      name: 'settings',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        theme: State.SQLite.text({ default: 'light' }),
        createdAt: State.SQLite.datetime({ default: { sql: 'CURRENT_TIMESTAMP' } }),
        count: State.SQLite.integer({ default: () => 0 }),
        note: State.SQLite.text({ nullable: true }),
      },
    })

    expectTypeOf(settings.insert).toBeCallableWith({ id: '1' })
    expectTypeOf<{ theme: string }>().not.toExtend<Parameters<typeof settings.insert>[0]>()
    expectTypeOf<typeof settings.Type>().toEqualTypeOf<{
      readonly id: string
      readonly theme: string
      readonly createdAt: Date
      readonly count: number
      readonly note: string | null
    }>()

    // the same holds for schema-based tables using `withDefault`
    const posts = State.SQLite.table({
      name: 'posts',
      schema: Schema.Struct({
        id: Schema.String.pipe(State.SQLite.withPrimaryKey),
        status: Schema.String.pipe(State.SQLite.withDefault('draft')),
        views: Schema.Int.pipe(State.SQLite.withDefault(0)),
      }),
    })
    expectTypeOf(posts.insert).toBeCallableWith({ id: '1' })
    expectTypeOf<{ id: string }>().toExtend<Parameters<typeof posts.insert>[0]>()
    expect(posts.sqliteDef.columns.status.default).toEqual(Option.some('draft'))

    // value and thunk defaults are constructor defaults of the row schema
    expect(settings.rowSchema.make({ id: '1', createdAt: new Date(0), note: null })).toEqual({
      id: '1',
      theme: 'light',
      createdAt: new Date(0),
      count: 0,
      note: null,
    })
    // a SQL default is evaluated by SQLite and cannot be constructed client-side
    const sqlDefaultFailure = Effect.runSync(Effect.result(settings.rowSchema.makeEffect({ id: '1', note: null })))
    expect(Result.isFailure(sqlDefaultFailure)).toBe(true)
    if (Result.isFailure(sqlDefaultFailure) === true) {
      expect(SchemaIssue.makeFormatterDefault()(sqlDefaultFailure.failure)).toMatch(/CURRENT_TIMESTAMP/)
    }
  })

  it('derives a table and its events from one canonical entity schema', async () => {
    // The pattern of an app that keeps one Effect struct per entity and derives table + event
    // schemas from its fields (`Schema.Date` fields, nullable JSON payloads, literal unions).
    const PageSchema = Schema.Struct({
      createdAt: Schema.Date,
      deletedAt: Schema.NullOr(Schema.Date),
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      name: Schema.String,
      settings: Schema.NullOr(Schema.Struct({ layout: Schema.Literals(['grid', 'list']) })),
      type: Schema.Literals(['auto', 'custom']),
      updatedAt: Schema.Date,
    }).annotate({ title: 'pages' })

    const pages = State.SQLite.table({ schema: PageSchema })
    const PageCreated = Schema.Struct({ ...PageSchema.fields, updatedAt: Schema.optional(PageSchema.fields.updatedAt) })

    expect(pages.sqliteDef.name).toBe('pages')
    expect(pages.sqliteDef.columns.createdAt.columnType).toBe('text')
    expect(pages.sqliteDef.columns.settings.columnType).toBe('text')
    expect(pages.sqliteDef.columns.type.columnType).toBe('text')

    const date = new Date('2026-01-02T03:04:05.678Z')
    const asserts = new TestSchema.Asserts(pages.rowSchema)
    await asserts.decoding().succeed(
      {
        createdAt: date.toISOString(),
        deletedAt: null,
        id: 'p1',
        name: 'Home',
        settings: JSON.stringify({ layout: 'grid' }),
        type: 'auto',
        updatedAt: date.toISOString(),
      },
      {
        createdAt: date,
        deletedAt: null,
        id: 'p1',
        name: 'Home',
        settings: { layout: 'grid' },
        type: 'auto',
        updatedAt: date,
      },
    )

    const { bindValues } = pages
      .insert({ createdAt: date, id: 'p1', name: 'Home', settings: null, type: 'auto', updatedAt: date })
      .asSql()
    expect(bindValues).toEqual([date.toISOString(), 'p1', 'Home', null, 'auto', date.toISOString()])

    expectTypeOf<typeof pages.Type>().toEqualTypeOf<{
      readonly createdAt: Date
      readonly deletedAt: Date | null
      readonly id: string
      readonly name: string
      readonly settings: { readonly layout: 'grid' | 'list' } | null
      readonly type: 'auto' | 'custom'
      readonly updatedAt: Date
    }>()
    expectTypeOf<(typeof PageCreated)['Type']['updatedAt']>().toEqualTypeOf<Date | undefined>()
  })

  it('types a schema-less json column as unknown and a default against the field type', () => {
    const documents = State.SQLite.table({
      name: 'documents',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        meta: State.SQLite.json(),
        note: State.SQLite.text({ nullable: true, default: null }),
      },
    })
    expectTypeOf<(typeof documents.Type)['meta']>().toEqualTypeOf<unknown>()
    expectTypeOf<(typeof documents.Type)['note']>().toEqualTypeOf<string | null>()
    // @ts-expect-error a non-nullable column cannot default to null
    State.SQLite.text({ default: null })

    // `withDefault` accepts a value of the field's type, and `null` only on a nullable field
    expectTypeOf(Schema.String.pipe(State.SQLite.withDefault('draft'))).toEqualTypeOf<
      State.SQLite.ColumnDefault<Schema.String>
    >()
    expectTypeOf(Schema.NullOr(Schema.String).pipe(State.SQLite.withDefault(null))).toEqualTypeOf<
      State.SQLite.ColumnDefault<Schema.NullOr<Schema.String>>
    >()
    expectTypeOf(Schema.String.pipe(State.SQLite.withDefault(null))).toEqualTypeOf<
      State.SQLite.DefaultValueMismatch<null, string>
    >()
    expectTypeOf(Schema.Int.pipe(State.SQLite.withDefault('0'))).toEqualTypeOf<
      State.SQLite.DefaultValueMismatch<'0', number>
    >()
    // @ts-expect-error the data-first form rejects the mismatch outright
    State.SQLite.withDefault(Schema.String, null)
  })

  it('keeps json() and unknown fields required on insert', () => {
    const documents = State.SQLite.table({
      name: 'documents',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        meta: State.SQLite.json(),
        payload: Schema.Unknown,
      },
    })
    expect(documents.sqliteDef.columns.meta.nullable).toBe(false)
    expect(documents.sqliteDef.columns.payload.nullable).toBe(false)
    expectTypeOf<{ id: string }>().not.toExtend<Parameters<typeof documents.insert>[0]>()
    expectTypeOf(documents.insert).toBeCallableWith({ id: '1', meta: { a: 1 }, payload: null })
    expectTypeOf(documents.rowSchema.fields.meta).toEqualTypeOf<Schema.fromJsonString<Schema.Unknown>>()
  })

  it('reads an optional-key field back as nullable', async () => {
    const notes = State.SQLite.table({
      name: 'notes',
      schema: Schema.Struct({
        id: Schema.String.pipe(State.SQLite.withPrimaryKey),
        title: Schema.optionalKey(Schema.String),
        done: Schema.optionalKey(Schema.Boolean),
      }),
    })
    expect(notes.sqliteDef.columns.title.nullable).toBe(true)
    expect(notes.sqliteDef.columns.done.nullable).toBe(true)
    expectTypeOf<(typeof notes.Type)['title']>().toEqualTypeOf<string | null>()
    expectTypeOf<(typeof notes.Type)['done']>().toEqualTypeOf<boolean | null>()
    expectTypeOf(notes.insert).toBeCallableWith({ id: '1' })
    const asserts = new TestSchema.Asserts(notes.rowSchema)
    await asserts.decoding().succeed({ id: '1', title: null, done: null })
  })

  it('accepts array and object defaults through the curried withDefault', () => {
    const Tags = Schema.Array(Schema.String)
    const MutableTags = Schema.mutable(Schema.Array(Schema.String))
    const Settings = Schema.Struct({ theme: Schema.String, sizes: Schema.mutable(Schema.Array(Schema.Int)) })
    expectTypeOf(Tags.pipe(State.SQLite.withDefault([]))).toEqualTypeOf<State.SQLite.ColumnDefault<typeof Tags>>()
    expectTypeOf(MutableTags.pipe(State.SQLite.withDefault([]))).toEqualTypeOf<
      State.SQLite.ColumnDefault<typeof MutableTags>
    >()
    expectTypeOf(Settings.pipe(State.SQLite.withDefault({ theme: 'light', sizes: [1] }))).toEqualTypeOf<
      State.SQLite.ColumnDefault<typeof Settings>
    >()
    expectTypeOf(Schema.Literals(['draft', 'published']).pipe(State.SQLite.withDefault('draft'))).toEqualTypeOf<
      State.SQLite.ColumnDefault<Schema.Literals<readonly ['draft', 'published']>>
    >()
  })

  it('accepts thunk defaults on literal-union fields', () => {
    const Status = Schema.Literals(['draft', 'published'])
    expectTypeOf(Status.pipe(State.SQLite.withDefault(() => 'draft'))).toEqualTypeOf<
      State.SQLite.ColumnDefault<typeof Status>
    >()
    expectTypeOf(Status.pipe(State.SQLite.withDefault(() => 5))).toEqualTypeOf<
      State.SQLite.DefaultValueMismatch<number, 'draft' | 'published'>
    >()
    expectTypeOf(State.SQLite.withDefault(Status, () => 'draft')).toEqualTypeOf<
      State.SQLite.ColumnDefault<typeof Status>
    >()
  })

  it('only treats LiveStore column defaults as omittable on insert', () => {
    // a plain Effect constructor default (the `_tag` of a tagged struct) is not a column default
    const events = State.SQLite.table({
      name: 'events',
      schema: Schema.TaggedStruct('Event', { id: Schema.String.pipe(State.SQLite.withPrimaryKey) }),
    })
    expect(events.sqliteDef.columns._tag.default).toEqual(Option.none())
    expectTypeOf<{ id: string }>().not.toExtend<Parameters<typeof events.insert>[0]>()
    expectTypeOf(events.insert).toBeCallableWith({ _tag: 'Event', id: '1' })
    expect(() => events.insert({ _tag: 'Event', id: '1' }).asSql()).not.toThrow()
  })

  it('classifies every supported field shape the same way at the type level and at runtime', () => {
    const Point = Schema.Struct({ x: Schema.Finite })
    const shapeFields = {
      id: State.SQLite.text({ primaryKey: true }),
      text: Schema.String,
      int: Schema.Int,
      nullOrText: Schema.NullOr(Schema.String),
      undefinedOrText: Schema.UndefinedOr(Schema.String),
      optionalText: Schema.optional(Schema.String),
      optionalKeyText: Schema.optionalKey(Schema.String),
      optionalKeyNullOrText: Schema.optionalKey(Schema.NullOr(Schema.String)),
      bool: Schema.Boolean,
      nullOrBool: Schema.NullOr(Schema.Boolean),
      boolLiteral: Schema.Literal(true),
      date: Schema.Date,
      dateFromString: Schema.DateFromString,
      dateFromMillis: Schema.DateFromMillis,
      nullOrDate: Schema.NullOr(Schema.Date),
      literals: Schema.Literals(['a', 'b']),
      numberLiterals: Schema.Literals([1, 2]),
      stringOrNumber: Schema.Union([Schema.String, Schema.Number]),
      struct: Point,
      nullOrStruct: Schema.NullOr(Point),
      json: State.SQLite.json(),
      nullableJson: State.SQLite.json({ nullable: true }),
      typedJson: State.SQLite.json({ schema: Point }),
      unknown: Schema.Unknown,
      nullOrUnknown: Schema.NullOr(Schema.Unknown),
      blob: Schema.Uint8Array,
      finiteFromString: Schema.FiniteFromString,
      branded: Schema.String.pipe(Schema.brand('Id')),
      null: Schema.Null,
      defaulted: State.SQLite.text({ default: 'x' }),
      nullableDefaulted: State.SQLite.integer({ nullable: true, default: null }),
    }
    const shapes = State.SQLite.table({ name: 'shapes', columns: shapeFields })
    // the classification types take the input fields; `rowSchema.fields` are the derived column codecs
    type Fields = typeof shapeFields
    type Row = typeof shapes.Type
    type Encoded = typeof shapes.Encoded
    const { columns } = shapes.sqliteDef
    const nullable = Object.fromEntries(Object.entries(columns).map(([name, column]) => [name, column.nullable]))
    const columnTypes = Object.fromEntries(Object.entries(columns).map(([name, column]) => [name, column.columnType]))

    // nullability: the type-level `IsNullable` agrees with `sqliteDef.columns[K].nullable`
    expect(nullable).toEqual({
      id: false,
      text: false,
      int: false,
      nullOrText: true,
      undefinedOrText: true,
      optionalText: true,
      optionalKeyText: true,
      optionalKeyNullOrText: true,
      bool: false,
      nullOrBool: true,
      boolLiteral: false,
      date: false,
      dateFromString: false,
      dateFromMillis: false,
      nullOrDate: true,
      literals: false,
      numberLiterals: false,
      stringOrNumber: false,
      struct: false,
      nullOrStruct: true,
      json: false,
      nullableJson: true,
      typedJson: false,
      unknown: false,
      nullOrUnknown: true,
      blob: false,
      finiteFromString: false,
      branded: false,
      null: true,
      defaulted: false,
      nullableDefaulted: true,
    })
    type Nullable = { [K in keyof Fields]: State.SQLite.FromFields.IsNullable<Fields[K]> }
    expectTypeOf<Nullable>().toEqualTypeOf<{
      id: false
      text: false
      int: false
      nullOrText: true
      undefinedOrText: true
      optionalText: true
      optionalKeyText: true
      optionalKeyNullOrText: true
      bool: false
      nullOrBool: true
      boolLiteral: false
      date: false
      dateFromString: false
      dateFromMillis: false
      nullOrDate: true
      literals: false
      numberLiterals: false
      stringOrNumber: false
      struct: false
      nullOrStruct: true
      json: false
      nullableJson: true
      typedJson: false
      unknown: false
      nullOrUnknown: true
      blob: false
      finiteFromString: false
      branded: false
      null: true
      defaulted: false
      nullableDefaulted: true
    }>()

    // storage: the type-level `Encoded` agrees with the column type and with what the codec writes
    expect(columnTypes).toEqual({
      id: 'text',
      text: 'text',
      int: 'integer',
      nullOrText: 'text',
      undefinedOrText: 'text',
      optionalText: 'text',
      optionalKeyText: 'text',
      optionalKeyNullOrText: 'text',
      bool: 'integer',
      nullOrBool: 'integer',
      boolLiteral: 'integer',
      date: 'text',
      dateFromString: 'text',
      dateFromMillis: 'integer',
      nullOrDate: 'text',
      literals: 'text',
      numberLiterals: 'integer',
      stringOrNumber: 'text',
      struct: 'text',
      nullOrStruct: 'text',
      json: 'text',
      nullableJson: 'text',
      typedJson: 'text',
      unknown: 'text',
      nullOrUnknown: 'text',
      blob: 'blob',
      finiteFromString: 'text',
      branded: 'text',
      null: 'text',
      defaulted: 'text',
      nullableDefaulted: 'integer',
    })
    const encode = <K extends keyof typeof columns>(column: K, value: Row[K]): Encoded[K] =>
      // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- the assertion under test is that the codec's output has the type-level `Encoded` type
      Schema.encodeUnknownSync(columns[column].schema)(value) as Encoded[K]
    const date = new Date('2026-01-02T03:04:05.678Z')
    expect(encode('bool', true)).toBe(1)
    expect(encode('nullOrBool', null)).toBeNull()
    expect(encode('boolLiteral', true)).toBe(1)
    expect(encode('date', date)).toBe(date.toISOString())
    expect(encode('nullOrDate', null)).toBeNull()
    expect(encode('dateFromMillis', date)).toBe(date.getTime())
    expect(encode('stringOrNumber', 'abc')).toBe('"abc"')
    expect(encode('struct', { x: 1 })).toBe('{"x":1}')
    expect(encode('nullOrStruct', null)).toBeNull()
    expect(encode('nullOrUnknown', { a: 1 })).toBe('{"a":1}')
    expect(encode('optionalKeyText', null)).toBeNull()
    expect(encode('finiteFromString', 42)).toBe('42')
    expectTypeOf<Encoded['stringOrNumber']>().toEqualTypeOf<string>()
    expectTypeOf<Encoded['bool']>().toEqualTypeOf<0 | 1>()
    expectTypeOf<Encoded['nullOrBool']>().toEqualTypeOf<0 | 1 | null>()
    expectTypeOf<Encoded['boolLiteral']>().toEqualTypeOf<0 | 1>()
    expectTypeOf<Encoded['date']>().toEqualTypeOf<string>()
    expectTypeOf<Encoded['nullOrDate']>().toEqualTypeOf<string | null>()
    expectTypeOf<Encoded['dateFromMillis']>().toEqualTypeOf<number>()
    expectTypeOf<Encoded['struct']>().toEqualTypeOf<string>()
    expectTypeOf<Encoded['nullOrStruct']>().toEqualTypeOf<string | null>()
    expectTypeOf<Encoded['nullOrUnknown']>().toEqualTypeOf<string | null>()
    expectTypeOf<Encoded['optionalKeyText']>().toEqualTypeOf<string | null>()
    expectTypeOf<Encoded['blob']>().toEqualTypeOf<Uint8Array>()
    expectTypeOf<Row['stringOrNumber']>().toEqualTypeOf<string | number>()
    expectTypeOf<Row['optionalKeyNullOrText']>().toEqualTypeOf<string | null>()
    expectTypeOf<Row['nullOrUnknown']>().toEqualTypeOf<unknown>()
    expectTypeOf<Row['branded']>().toEqualTypeOf<string & Brand.Brand<'Id'>>()
    expectTypeOf<Row['null']>().toEqualTypeOf<null>()

    // insert: nullable and defaulted columns are omittable, everything else is required
    expectTypeOf(shapes.insert).toBeCallableWith({
      id: '1',
      text: 't',
      int: 1,
      bool: true,
      boolLiteral: true,
      date,
      dateFromString: date,
      dateFromMillis: date,
      literals: 'a',
      numberLiterals: 1,
      stringOrNumber: 1,
      struct: { x: 1 },
      json: {},
      typedJson: { x: 1 },
      unknown: 1,
      blob: new Uint8Array(),
      finiteFromString: 1,
      branded: 'b' as string & Brand.Brand<'Id'>,
    })
    expectTypeOf<{ id: string }>().not.toExtend<Parameters<typeof shapes.insert>[0]>()
    type Omittable = State.SQLite.FromFields.OmittableInsertColumnNames<Fields>
    expectTypeOf<Omittable>().toEqualTypeOf<
      | 'nullOrText'
      | 'undefinedOrText'
      | 'optionalText'
      | 'optionalKeyText'
      | 'optionalKeyNullOrText'
      | 'nullOrBool'
      | 'nullOrDate'
      | 'nullOrStruct'
      | 'nullableJson'
      | 'nullOrUnknown'
      | 'null'
      | 'defaulted'
      | 'nullableDefaulted'
    >()
    const runtimeOmittable = Object.entries(columns)
      .filter(([, column]) => column.nullable === true || column.default._tag === 'Some')
      .map(([name]) => name)
      .sort()
    expect(runtimeOmittable).toEqual(
      [
        'nullOrText',
        'undefinedOrText',
        'optionalText',
        'optionalKeyText',
        'optionalKeyNullOrText',
        'nullOrBool',
        'nullOrDate',
        'nullOrStruct',
        'nullableJson',
        'nullOrUnknown',
        'null',
        'defaulted',
        'nullableDefaulted',
      ].sort(),
    )
  })

  it('keeps nullable fields of non-struct schemas omittable on insert', () => {
    const Shape = Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('circle'),
        n: Schema.NullOr(Schema.Int),
        note: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal('square'),
        n: Schema.NullOr(Schema.Int),
        note: Schema.optional(Schema.String),
      }),
    ])
    const shapes = State.SQLite.table({ name: 'shapes', schema: Shape })
    expect(shapes.sqliteDef.columns.n.nullable).toBe(true)
    expect(shapes.sqliteDef.columns.note.nullable).toBe(true)
    expectTypeOf(shapes.insert).toBeCallableWith({ kind: 'circle' })
    expectTypeOf<(typeof shapes.Type)['n']>().toEqualTypeOf<number | null>()
    expectTypeOf<(typeof shapes.Type)['note']>().toEqualTypeOf<string | null>()
    expectTypeOf<(typeof shapes.Encoded)['kind']>().toEqualTypeOf<'circle' | 'square'>()
    expect(shapes.insert({ kind: 'circle' }).asSql().bindValues).toEqual(['circle'])
  })

  it('fills thunk defaults on insert and leaves value and SQL defaults to SQLite', () => {
    let counter = 0
    const rows = State.SQLite.table({
      name: 'rows',
      columns: {
        id: State.SQLite.text({ primaryKey: true }),
        theme: State.SQLite.text({ default: 'light' }),
        seq: State.SQLite.integer({ default: () => ++counter }),
        createdAt: State.SQLite.text({ default: { sql: 'CURRENT_TIMESTAMP' } }),
        note: State.SQLite.text({ nullable: true }),
      },
    })
    const first = rows.insert({ id: '1' }).asSql()
    expect(first.query).toBe(`INSERT INTO 'rows' ("id", "seq") VALUES (?, ?)`)
    expect(first.bindValues).toEqual(['1', 1])
    // an explicit `undefined` counts as omitted
    const second = rows.insert({ id: '2', theme: undefined, note: undefined }).asSql()
    expect(second.query).toBe(`INSERT INTO 'rows' ("id", "seq") VALUES (?, ?)`)
    expect(second.bindValues).toEqual(['2', 2])
    // the same for a schema-based table with `withDefault`
    const posts = State.SQLite.table({
      name: 'posts',
      schema: Schema.Struct({
        id: Schema.String.pipe(State.SQLite.withPrimaryKey),
        views: Schema.Int.pipe(State.SQLite.withDefault(() => 7)),
      }),
    })
    expect(posts.insert({ id: 'p' }).asSql().bindValues).toEqual(['p', 7])
  })

  it('should handle Schema.Int as integer column', () => {
    const CounterSchema = Schema.Struct({
      id: Schema.String,
      count: Schema.Int,
    })

    const counterTable = State.SQLite.table({
      name: 'counters',
      schema: CounterSchema,
    })

    expect(counterTable.sqliteDef.columns.count.columnType).toBe('integer')
  })

  it('should work with Schema.Class', () => {
    class User extends Schema.Class<User>('User')({
      id: Schema.String,
      name: Schema.String,
      email: Schema.optional(Schema.String),
      age: Schema.Int,
    }) {}

    const userTable = State.SQLite.table({
      name: 'users',
      schema: User,
    })

    expect(userTable.sqliteDef.name).toBe('users')
    expect(userTable.sqliteDef.columns).toHaveProperty('id')
    expect(userTable.sqliteDef.columns).toHaveProperty('name')
    expect(userTable.sqliteDef.columns).toHaveProperty('email')
    expect(userTable.sqliteDef.columns).toHaveProperty('age')

    // Check column types
    expect(userTable.sqliteDef.columns.id.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.name.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.email.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.email.nullable).toBe(true)
    expect(userTable.sqliteDef.columns.age.columnType).toBe('integer')
  })

  it('should support schemas that transform flat columns into nested types', () => {
    const Flat = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      contactFirstName: Schema.String,
      contactLastName: Schema.String,
      contactEmail: Schema.String.pipe(State.SQLite.withUnique),
    })

    const Nested = Flat.pipe(
      Schema.decodeTo(
        Schema.Struct({
          id: Schema.String,
          contact: Schema.Struct({
            firstName: Schema.String,
            lastName: Schema.String,
            email: Schema.String,
          }),
        }),
        SchemaTransformation.transform({
          decode: ({ id, contactFirstName, contactLastName, contactEmail }) => ({
            id,
            contact: {
              firstName: contactFirstName,
              lastName: contactLastName,
              email: contactEmail,
            },
          }),
          encode: ({ id, contact }) => ({
            id,
            contactFirstName: contact.firstName,
            contactLastName: contact.lastName,
            contactEmail: contact.email,
          }),
        }),
      ),
    )

    const contactsTable = State.SQLite.table({
      name: 'contacts',
      schema: Nested,
    })

    const columns = contactsTable.sqliteDef.columns

    expect(Object.keys(columns)).toEqual(['id', 'contactFirstName', 'contactLastName', 'contactEmail'])
    expect(columns.id.primaryKey).toBe(true)
    expect(columns.contactEmail.columnType).toBe('text')
    expect(contactsTable.sqliteDef.indexes).toContainEqual({
      name: 'idx_contacts_contactEmail_unique',
      columns: ['contactEmail'],
      isUnique: true,
    })
  })

  it('should extract table name from Schema.Class identifier', () => {
    class TodoItem extends Schema.Class<TodoItem>('TodoItem')({
      id: Schema.String,
      text: Schema.String,
      completed: Schema.Boolean,
    }) {}

    // Schema.Class doesn't set identifier/title annotations, so we need to provide an explicit name
    const todosTable = State.SQLite.table({
      name: 'TodoItem',
      schema: TodoItem,
    })

    expect(todosTable.sqliteDef.name).toBe('TodoItem')
  })

  it('should properly infer types from schema', async () => {
    const UserSchema = Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      age: Schema.Int,
      active: Schema.Boolean,
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    })

    const userTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    // Test that Type is properly inferred
    type UserType = typeof userTable.Type
    const _userTypeCheck: UserType = {
      id: 'test-id',
      name: 'John',
      age: 30,
      active: true,
      metadata: { key1: 'value1', key2: 123 },
    }

    // Test that columns have proper schema types
    type IdColumn = typeof userTable.sqliteDef.columns.id
    type NameColumn = typeof userTable.sqliteDef.columns.name
    type AgeColumn = typeof userTable.sqliteDef.columns.age
    type ActiveColumn = typeof userTable.sqliteDef.columns.active
    type MetadataColumn = typeof userTable.sqliteDef.columns.metadata

    // These should compile without errors
    const _idCheck: IdColumn['schema']['Type'] = 'string'
    const _nameCheck: NameColumn['schema']['Type'] = 'string'
    const _ageCheck: AgeColumn['schema']['Type'] = 123
    const _activeCheck: ActiveColumn['schema']['Type'] = true
    const _metadataCheck: MetadataColumn['schema']['Type'] = { foo: 'bar' }

    // Verify column definitions
    expect(userTable.sqliteDef.columns.id.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.name.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.age.columnType).toBe('integer')
    expect(userTable.sqliteDef.columns.active.columnType).toBe('integer')
    expect(userTable.sqliteDef.columns.metadata.columnType).toBe('text')
    expect(userTable.sqliteDef.columns.metadata.nullable).toBe(true)

    const asserts = new TestSchema.Asserts(userTable.rowSchema)
    await asserts.decoding().succeed(
      {
        id: 'test-id',
        name: 'John',
        age: 30,
        active: 1,
        metadata: JSON.stringify({ key1: 'value1', key2: 123 }),
      },
      {
        id: 'test-id',
        name: 'John',
        age: 30,
        active: true,
        metadata: { key1: 'value1', key2: 123 },
      },
    )
    const activeAsserts = new TestSchema.Asserts(userTable.sqliteDef.columns.active.schema)
    const metadataAsserts = new TestSchema.Asserts(userTable.sqliteDef.columns.metadata.schema)
    await activeAsserts.decoding().succeed(0, false)
    await metadataAsserts.decoding().succeed(null)
  })

  it('should allow omitting nullable fields in insert()', () => {
    const UserSchema = Schema.Struct({
      id: Schema.String.pipe(State.SQLite.withPrimaryKey),
      undefined: Schema.Undefined,
      null: Schema.Null,
      undefinedOrString: Schema.UndefinedOr(Schema.String),
      nullOrString: Schema.NullOr(Schema.String),
      optionalString: Schema.optional(Schema.String),
      optionalNullOrString: Schema.optional(Schema.NullOr(Schema.String)),
    })

    const usersTable = State.SQLite.table({
      name: 'users',
      schema: UserSchema,
    })

    // Non-nullable fields (id) are required — omitting id should be rejected
    expectTypeOf<{ undefined: undefined }>().not.toExtend<Parameters<typeof usersTable.insert>[0]>()

    // Nullable fields (NullOr, optional+NullOr) are omittable — SQL defaults to NULL
    expectTypeOf(usersTable.insert)
      .toBeCallableWith({ id: '1' })
      .toBeCallableWith({ id: '1', undefined: undefined })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: undefined })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string' })
      .toBeCallableWith({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: null })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
        optionalNullOrString: null,
      })
      .toBeCallableWith({
        id: '1',
        undefined: undefined,
        null: null,
        undefinedOrString: 'string',
        nullOrString: 'string',
        optionalString: 'string',
        optionalNullOrString: 'string',
      })

    expect(() => usersTable.insert({ id: '1' }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', undefined: undefined }).asSql()).not.toThrow()
    expect(() => usersTable.insert({ id: '1', undefined: undefined, null: null }).asSql()).not.toThrow()
    expect(() =>
      usersTable.insert({ id: '1', undefined: undefined, null: null, undefinedOrString: undefined }).asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable.insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string' }).asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: null })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({ id: '1', undefined: undefined, null: null, undefinedOrString: 'string', nullOrString: 'string' })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
        })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
          optionalNullOrString: null,
        })
        .asSql(),
    ).not.toThrow()
    expect(() =>
      usersTable
        .insert({
          id: '1',
          undefined: undefined,
          null: null,
          undefinedOrString: 'string',
          nullOrString: 'string',
          optionalString: 'string',
          optionalNullOrString: 'string',
        })
        .asSql(),
    ).not.toThrow()
  })

  it('supports discriminated unions with parsed JSON payloads', () => {
    const CircleDataSchema = Schema.Struct({
      radius: Schema.Finite,
    })
    const CircleSchema = Schema.Struct({
      kind: Schema.Literal('circle'),
      data: Schema.fromJsonString(CircleDataSchema),
    })

    const SquareDataSchema = Schema.Struct({
      sideLength: Schema.Finite,
    })
    const SquareSchema = Schema.Struct({
      kind: Schema.Literal('square'),
      data: Schema.fromJsonString(SquareDataSchema),
    })

    const ShapeSchema = Schema.Union([CircleSchema, SquareSchema])

    const shapes = State.SQLite.table({
      name: 'shapes',
      schema: ShapeSchema,
    })

    expect(shapes.sqliteDef.columns.kind.columnType).toBe('text')
    expect(SchemaAST.isUnion(Schema.toEncoded(shapes.sqliteDef.columns.kind.schema).ast)).toBe(true)

    expect(() =>
      shapes
        .insert({
          kind: 'square',
          data: { sideLength: 10 },
        })
        .asSql(),
    ).not.toThrow()

    expect(() =>
      shapes
        .insert({
          kind: 'circle',
          data: { radius: 5 },
        })
        .asSql(),
    ).not.toThrow()
  })

  it('treats optional common union fields as nullable columns', () => {
    const StateSchema = Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('empty'),
        note: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal('ready'),
        note: Schema.optional(Schema.String),
      }),
    ])

    const states = State.SQLite.table({
      name: 'states',
      schema: StateSchema,
    })

    expect(states.sqliteDef.columns.kind.columnType).toBe('text')
    expect(states.sqliteDef.columns.note.columnType).toBe('text')
    expect(states.sqliteDef.columns.note.nullable).toBe(true)
  })
})
