import { Schema, SessionIdSymbol, State } from "@livestore/livestore";

export const filterFoodsDocument = State.SQLite.clientDocument({
  name: "filterFoods",
  schema: Schema.Struct({ name: Schema.String }),
  default: {
    // Using the SessionIdSymbol as default id means the UiState will be scoped per client session (i.e. browser tab).
    id: SessionIdSymbol,
    value: { name: "" },
  },
});
