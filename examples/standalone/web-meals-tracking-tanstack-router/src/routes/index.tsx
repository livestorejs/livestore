import { createFileRoute } from '@tanstack/react-router'

import { FoodsList } from '../components/foods-list.js'
import { InsertFoodForm } from '../components/insert-food-form.js'
import { InsertMealForm } from '../components/insert-meal-form.js'
import { MealsList } from '../components/meals-list.js'

const App = () => {
  return (
    <>
      <InsertFoodForm />
      <InsertMealForm />
      <FoodsList />
      <MealsList />
    </>
  )
}

export const Route = createFileRoute('/')({ component: App })
