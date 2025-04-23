import { useStore } from "@livestore/react";
import { useSearch } from "@tanstack/react-router";
import { allFoodsQuery$ } from "../lib/queries";
import { events } from "../lib/schema";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export default function InsertMealForm() {
  const { date } = useSearch({ from: "/" });
  const { store } = useStore();

  const foods = store.useQuery(allFoodsQuery$);
  const action = (formData: globalThis.FormData) => {
    const foodId = formData.get("foodId");
    const quantity = formData.get("quantity");
    store.commit(
      events.mealCreated({
        date,
        id: crypto.randomUUID(),
        foodId: foodId as string,
        quantity: Number(quantity),
      })
    );
  };

  return (
    <form action={action} className="flex flex-col gap-y-2">
      <Input type="number" name="quantity" placeholder="Quantity" />
      <div className="flex flex-wrap gap-4">
        {foods.map((food) => (
          <label key={food.id} className="flex items-center gap-x-1">
            <input type="radio" name="foodId" value={food.id} />
            <span className="text-sm font-light">{food.name}</span>
          </label>
        ))}
      </div>
      <Button type="submit">Insert meal</Button>
    </form>
  );
}
