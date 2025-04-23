import { Schema, State } from "@livestore/livestore";

/**
 * ?: How to define joins between tables?
 */

const NonNegativeNumber = Schema.Number.pipe(Schema.nonNegative());

// ?: How are `schema` enforced/checked? It's throwing a `ParseError`
export const foods = State.SQLite.table({
  name: "food",
  // TODO: Make `indexes.columns` type safe based on table `columns`
  indexes: [{ columns: ["name"], name: "name", isUnique: true }],
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    // TODO: Add jsdoc for `nullable` as `false` by default
    name: State.SQLite.text({ schema: Schema.NonEmptyString }),
    calories: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    protein: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    carbs: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    fat: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
  },
});

export const meals = State.SQLite.table({
  name: "meal",
  columns: {
    id: State.SQLite.text({ primaryKey: true, schema: Schema.UUID }),
    foodId: State.SQLite.text({ schema: Schema.UUID }),
    quantity: State.SQLite.integer({ default: 0, schema: NonNegativeNumber }),
    date: State.SQLite.text(),
  },
});
