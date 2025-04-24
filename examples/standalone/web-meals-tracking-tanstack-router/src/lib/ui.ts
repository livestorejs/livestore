import { Schema, SessionIdSymbol, State } from '@livestore/livestore'

export const filterFoodsDocument = State.SQLite.clientDocument({
  name: 'filterFoods',
  schema: Schema.Struct({ name: Schema.String }),
  default: {
    id: SessionIdSymbol,
    value: { name: '' },
  },
})
