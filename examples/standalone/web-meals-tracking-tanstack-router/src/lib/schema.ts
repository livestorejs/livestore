import { makeSchema, State } from "@livestore/livestore";
import * as sqlEvents from "./events";
import { materializers } from "./materializers";
import * as sqlTables from "./tables";
import * as uiDocuments from "./ui";

const events = {
  ...sqlEvents,
  setFilterFoods: uiDocuments.filterFoodsDocument.set,
};
const tables = { ...sqlTables, ...uiDocuments };

const state = State.SQLite.makeState({ tables, materializers });

export { events, tables };
export const schema = makeSchema({ events, state });
