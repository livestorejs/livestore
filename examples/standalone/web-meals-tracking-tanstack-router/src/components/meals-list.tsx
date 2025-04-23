import { useStore } from "@livestore/react";
import { mealUpdated } from "../lib/events";
import {
  convertedMealsQuery$,
  filterFoodsQuery$,
  totalMacrosQuery$,
} from "../lib/queries";
import { events } from "../lib/schema";
import { Hr } from "./ui/hr";
import { Input } from "./ui/input";

export default function MealsList() {
  const { store } = useStore();
  const filterFoods = store.useQuery(filterFoodsQuery$);
  const totalMacros = store.useQuery(totalMacrosQuery$);
  const meals = store.useQuery(convertedMealsQuery$);
  return (
    <div className="flex flex-col gap-y-4">
      <h2 className="text-lg font-bold">Meals</h2>
      <div className="flex items-center justify-between gap-x-2">
        <div className="flex flex-col gap-y-1 items-center justify-center">
          <p className="text-sm font-light">Calories</p>
          <p className="text-sm font-bold">{totalMacros.calories.toFixed(2)}</p>
        </div>
        <div className="flex flex-col gap-y-1 items-center justify-center">
          <p className="text-sm font-light">Protein</p>
          <p className="text-sm font-bold">{totalMacros.protein.toFixed(2)}</p>
        </div>
        <div className="flex flex-col gap-y-1 items-center justify-center">
          <p className="text-sm font-light">Carbs</p>
          <p className="text-sm font-bold">{totalMacros.carbs.toFixed(2)}</p>
        </div>
        <div className="flex flex-col gap-y-1 items-center justify-center">
          <p className="text-sm font-light">Fat</p>
          <p className="text-sm font-bold">{totalMacros.fat.toFixed(2)}</p>
        </div>
      </div>
      <Input
        type="text"
        placeholder="Filter by food name"
        value={filterFoods.name}
        onChange={(e) => {
          store.commit(events.setFilterFoods({ name: e.target.value }));
        }}
      />

      <Hr />

      <div className="flex flex-col gap-y-4">
        {meals.map((meal) => (
          <div key={meal.id} className="flex items-center justify-between">
            <div className="flex flex-col gap-y-2">
              <p className="text-lg font-medium capitalize">{meal.name}</p>
              <Input
                type="number"
                value={meal.quantity}
                onChange={(e) => {
                  store.commit(
                    mealUpdated({
                      id: meal.id,
                      quantity: e.target.valueAsNumber,
                    })
                  );
                }}
              />
            </div>
            <div className="flex items-center gap-x-4">
              <div className="flex flex-col gap-y-1 items-center justify-center">
                <p className="text-sm font-light">Calories</p>
                <p className="text-sm font-bold">{meal.calories.toFixed(2)}</p>
              </div>
              <div className="flex flex-col gap-y-1 items-center justify-center">
                <p className="text-sm font-light">Protein</p>
                <p className="text-sm font-bold">{meal.protein.toFixed(2)}</p>
              </div>
              <div className="flex flex-col gap-y-1 items-center justify-center">
                <p className="text-sm font-light">Carbs</p>
                <p className="text-sm font-bold">{meal.carbs.toFixed(2)}</p>
              </div>
              <div className="flex flex-col gap-y-1 items-center justify-center">
                <p className="text-sm font-light">Fat</p>
                <p className="text-sm font-bold">{meal.fat.toFixed(2)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
