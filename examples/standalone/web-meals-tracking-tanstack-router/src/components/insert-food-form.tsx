import { useStore } from "@livestore/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { events } from "../lib/schema";

export default function InsertFoodForm() {
  const { store } = useStore();
  const action = (formData: globalThis.FormData) => {
    const name = formData.get("name");
    const calories = formData.get("calories");
    const protein = formData.get("protein");
    const carbs = formData.get("carbs");
    const fat = formData.get("fat");
    store.commit(
      events.foodCreated({
        name: name as string,
        calories: Number(calories),
        protein: Number(protein),
        carbs: Number(carbs),
        fat: Number(fat),
      })
    );
  };
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Input type="text" name="name" placeholder="Name" />
        <Input type="number" name="calories" placeholder="Calories" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input type="number" name="protein" placeholder="Protein" />
        <Input type="number" name="carbs" placeholder="Carbs" />
        <Input type="number" name="fat" placeholder="Fat" />
      </div>
      <Button type="submit">Insert food</Button>
    </form>
  );
}
