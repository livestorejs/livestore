import { useStore } from "@livestore/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DateTime, Effect, Schema } from "effect";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import FoodsList from "../components/foods-list";
import InsertFoodForm from "../components/insert-food-form";
import InsertMealForm from "../components/insert-meal-form";
import MealsList from "../components/meals-list";
import { Hr } from "../components/ui/hr";
import { dateSearchParamSignal$ } from "../lib/queries";

export const Route = createFileRoute("/")({
  component: App,
  validateSearch: (params) =>
    Effect.runSync(
      Schema.decodeUnknown(Schema.Struct({ date: Schema.DateTimeUtc }))(
        params
      ).pipe(
        Effect.orElse(() =>
          DateTime.now.pipe(Effect.map((date) => ({ date })))
        ),
        Effect.map((params) => ({
          date: DateTime.formatIsoDateUtc(params.date),
        }))
      )
    ),
});

function App() {
  const { date } = Route.useSearch();
  const { store } = useStore();

  useEffect(() => {
    store.setSignal(dateSearchParamSignal$, date);
  }, [date]);

  return (
    <div className="flex flex-col gap-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="."
          search={() => ({
            date: DateTime.formatIsoDateUtc(
              DateTime.subtract(DateTime.unsafeFromDate(new Date(date)), {
                days: 1,
              })
            ),
          })}
        >
          <ArrowLeft />
        </Link>
        <p className="text-2xl font-bold">{date}</p>
        <Link
          to="."
          search={() => ({
            date: DateTime.formatIsoDateUtc(
              DateTime.add(DateTime.unsafeFromDate(new Date(date)), {
                days: 1,
              })
            ),
          })}
        >
          <ArrowRight />
        </Link>
      </div>

      <InsertFoodForm />

      <Hr />

      <InsertMealForm />

      <Hr />

      <FoodsList />

      <Hr />

      <MealsList />
    </div>
  );
}
