import { useStore } from "@livestore/react";
import { foodUpdated } from "../lib/events";
import { allFoodsQuery$ } from "../lib/queries";
import { Input } from "./ui/input";

export default function FoodsList() {
  const { store } = useStore();
  const foods = store.useQuery(allFoodsQuery$);
  return (
    <div className="flex flex-col gap-y-4">
      <h2 className="text-lg font-bold">Foods</h2>
      <div className="flex flex-col gap-y-2">
        {foods.map((food) => (
          <div key={food.id} className="grid grid-cols-5 gap-x-2">
            <Input
              type="text"
              value={food.name}
              onChange={(e) => {
                store.commit(
                  foodUpdated({ id: food.id, name: e.target.value })
                );
              }}
            />
            <Input
              type="number"
              value={food.calories}
              onChange={(e) => {
                store.commit(
                  foodUpdated({ id: food.id, calories: e.target.valueAsNumber })
                );
              }}
            />
            <Input
              type="number"
              value={food.protein}
              onChange={(e) => {
                store.commit(
                  foodUpdated({ id: food.id, protein: e.target.valueAsNumber })
                );
              }}
            />
            <Input
              type="number"
              value={food.carbs}
              onChange={(e) => {
                store.commit(
                  foodUpdated({ id: food.id, carbs: e.target.valueAsNumber })
                );
              }}
            />
            <Input
              type="number"
              value={food.fat}
              onChange={(e) => {
                store.commit(
                  foodUpdated({ id: food.id, fat: e.target.valueAsNumber })
                );
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
