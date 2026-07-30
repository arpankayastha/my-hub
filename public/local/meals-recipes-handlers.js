/**
 * Local API handlers for meals and recipes (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';

const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekEnd(dateStr) {
  const start = weekStart(dateStr);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function normalizeMealTypes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const unique = [...new Set(source.filter((t) => VALID_MEAL_TYPES.includes(t)))];
  return unique.length ? unique : [...VALID_MEAL_TYPES];
}

function enrichMeal(meal, state, findUser) {
  const creator = findUser(meal.created_by);
  const ingredients = state.meal_ingredients.filter((i) => i.meal_id === meal.id);
  let recipe_ingredient_count = 0;
  if (meal.recipe_id && !ingredients.length) {
    recipe_ingredient_count = state.recipe_ingredients.filter((i) => i.recipe_id === meal.recipe_id).length;
  }
  return {
    ...meal,
    creator_name: creator?.display_name ?? null,
    creator_color: creator?.avatar_color ?? null,
    ingredients,
    recipe_ingredient_count,
  };
}

function enrichRecipe(recipe, state, findUser) {
  const creator = findUser(recipe.created_by);
  return {
    ...recipe,
    meal_types: normalizeMealTypes(recipe.meal_types),
    creator_name: creator?.display_name ?? null,
    creator_color: creator?.avatar_color ?? null,
    ingredients: state.recipe_ingredients.filter((i) => i.recipe_id === recipe.id),
  };
}

function sanitizedIngredients(ingredients) {
  return (ingredients || [])
    .map((ing) => ({
      name: String(ing.name || '').trim(),
      quantity: String(ing.quantity || '').trim() || null,
      category: String(ing.category || '').trim() || 'Sonstiges',
    }))
    .filter((ing) => ing.name);
}

function replaceMealIngredients(state, mealId, ingredients) {
  state.meal_ingredients = state.meal_ingredients.filter((i) => i.meal_id !== mealId);
  sanitizedIngredients(ingredients).forEach((ing) => {
    state.meal_ingredients.push({
      id: nextId(),
      meal_id: mealId,
      name: ing.name,
      quantity: ing.quantity,
      category: ing.category,
      on_shopping_list: 0,
    });
  });
}

function replaceRecipeIngredients(state, recipeId, ingredients) {
  state.recipe_ingredients = state.recipe_ingredients.filter((i) => i.recipe_id !== recipeId);
  sanitizedIngredients(ingredients).forEach((ing) => {
    state.recipe_ingredients.push({
      id: nextId(),
      recipe_id: recipeId,
      name: ing.name,
      quantity: ing.quantity,
      category: ing.category,
    });
  });
}

function addIngredientsToShoppingList(state, ingredients, listId, userId) {
  let added = 0;
  if (!state.shopping_lists.find((l) => l.id === listId)) return added;
  for (const ing of ingredients) {
    const exists = state.shopping_items.some(
      (i) => i.list_id === listId && !i.is_checked && i.name.toLowerCase() === ing.name.toLowerCase(),
    );
    if (exists) continue;
    state.shopping_items.push({
      id: nextId(),
      list_id: listId,
      name: ing.name,
      quantity: ing.quantity,
      category: ing.category || 'Sonstiges',
      is_checked: 0,
      created_by: userId,
      created_at: nowIso(),
    });
    added += 1;
  }
  return added;
}

export function ensureMealsRecipesState(state) {
  if (!Array.isArray(state.meal_ingredients)) state.meal_ingredients = [];
  if (!Array.isArray(state.recipe_ingredients)) state.recipe_ingredients = [];
}

/**
 * @returns {object|null}
 */
export async function handleMealsApi(m, parts, query, body, state, userId, findUser) {
  ensureMealsRecipesState(state);
  const method = m.toUpperCase();

  if (parts[1] === 'suggestions' && method === 'GET') {
    const q = String(query.q || '').trim().toLowerCase();
    if (!q) return { data: [] };
    const seen = new Set();
    const rows = [];
    for (const meal of state.meals) {
      if (!meal.title?.toLowerCase().startsWith(q)) continue;
      const key = `${meal.title}\0${meal.meal_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ title: meal.title, meal_type: meal.meal_type });
      if (rows.length >= 10) break;
    }
    return { data: rows };
  }

  if (parts[1] === 'apply-plan' && method === 'POST') {
    const assignments = Array.isArray(body?.assignments) ? body.assignments : [];
    if (!assignments.length) throw apiError('At least one meal is required.', 400);
    const replace = body?.replace_existing === true;
    const created = [];
    for (const a of assignments) {
      if (!a.date || !a.meal_type || !a.title) throw apiError('Invalid assignment.', 400);
      if (replace) {
        const doomed = state.meals.filter((meal) => meal.date === a.date && meal.meal_type === a.meal_type);
        doomed.forEach((meal) => {
          state.meal_ingredients = state.meal_ingredients.filter((i) => i.meal_id !== meal.id);
        });
        state.meals = state.meals.filter((meal) => meal.date !== a.date || meal.meal_type !== a.meal_type);
      }
      const id = nextId();
      const meal = {
        id,
        date: a.date,
        meal_type: a.meal_type,
        title: String(a.title).trim(),
        notes: a.notes ?? null,
        recipe_url: a.recipe_url ?? null,
        recipe_id: a.recipe_id ?? null,
        recurrence_template_id: null,
        created_by: userId,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.meals.push(meal);
      replaceMealIngredients(state, id, a.ingredients);
      created.push(enrichMeal(meal, state, findUser));
    }
    await saveState();
    return { data: created };
  }

  const mealId = Number(parts[1]);
  if (mealId && parts[2] === 'ingredients' && method === 'POST') {
    const meal = state.meals.find((x) => x.id === mealId);
    if (!meal) throw apiError('Meal not found.', 404);
    const ing = {
      id: nextId(),
      meal_id: mealId,
      name: String(body.name || '').trim(),
      quantity: body.quantity ?? null,
      category: body.category || 'Sonstiges',
      on_shopping_list: 0,
    };
    if (!ing.name) throw apiError('Name is required.', 400);
    state.meal_ingredients.push(ing);
    await saveState();
    return { data: ing };
  }

  if (mealId && parts[2] === 'to-shopping-list' && method === 'POST') {
    const meal = state.meals.find((x) => x.id === mealId);
    if (!meal) throw apiError('Meal not found.', 404);
    let ingredients = state.meal_ingredients.filter((i) => i.meal_id === mealId);
    if (!ingredients.length && meal.recipe_id) {
      state.recipe_ingredients
        .filter((i) => i.recipe_id === meal.recipe_id)
        .forEach((ing) => {
          state.meal_ingredients.push({
            id: nextId(),
            meal_id: mealId,
            name: ing.name,
            quantity: ing.quantity,
            category: ing.category,
            on_shopping_list: 0,
          });
        });
      ingredients = state.meal_ingredients.filter((i) => i.meal_id === mealId);
    }
    const listId = body?.list_id || state.shopping_lists[0]?.id;
    if (!listId) throw apiError('No shopping list.', 400);
    addIngredientsToShoppingList(state, ingredients, listId, userId);
    ingredients.forEach((i) => { i.on_shopping_list = 1; });
    await saveState();
    return { data: { added: ingredients.length } };
  }

  if (parts[1] === 'ingredients' && method === 'DELETE') {
    const ingId = Number(parts[2]);
    state.meal_ingredients = state.meal_ingredients.filter((i) => i.id !== ingId);
    await saveState();
    return { ok: true };
  }

  if (method === 'GET' && !parts[1]) {
    const ref = query.week && /^\d{4}-\d{2}-\d{2}$/.test(query.week)
      ? query.week
      : new Date().toISOString().slice(0, 10);
    const from = weekStart(ref);
    const to = weekEnd(ref);
    const meals = state.meals
      .filter((meal) => meal.date >= from && meal.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      data: meals.map((m) => enrichMeal(m, state, findUser)),
      weekStart: from,
      weekEnd: to,
    };
  }

  if (method === 'POST' && !parts[1]) {
    const id = nextId();
    const meal = {
      id,
      date: body.date,
      meal_type: body.meal_type,
      title: String(body.title || '').trim(),
      notes: body.notes ?? null,
      recipe_url: body.recipe_url ?? null,
      recipe_id: body.recipe_id ?? null,
      recurrence_template_id: null,
      created_by: userId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    if (!meal.date || !meal.meal_type || !meal.title) throw apiError('date, meal_type and title are required.', 400);
    state.meals.push(meal);
    replaceMealIngredients(state, id, body.ingredients);
    await saveState();
    return { data: enrichMeal(meal, state, findUser) };
  }

  if (mealId && method === 'PUT') {
    const meal = state.meals.find((x) => x.id === mealId);
    if (!meal) throw apiError('Meal not found.', 404);
    if (body.date !== undefined) meal.date = body.date;
    if (body.meal_type !== undefined) meal.meal_type = body.meal_type;
    if (body.title !== undefined) meal.title = String(body.title).trim();
    if (body.notes !== undefined) meal.notes = body.notes;
    if (body.recipe_url !== undefined) meal.recipe_url = body.recipe_url;
    if (body.recipe_id !== undefined) meal.recipe_id = body.recipe_id;
    if (body.ingredients !== undefined) replaceMealIngredients(state, mealId, body.ingredients);
    meal.updated_at = nowIso();
    await saveState();
    return { data: enrichMeal(meal, state, findUser) };
  }

  if (mealId && method === 'DELETE') {
    const idx = state.meals.findIndex((x) => x.id === mealId);
    if (idx === -1) throw apiError('Meal not found.', 404);
    state.meal_ingredients = state.meal_ingredients.filter((i) => i.meal_id !== mealId);
    state.meals.splice(idx, 1);
    await saveState();
    return { ok: true };
  }

  return null;
}

/**
 * @returns {object|null}
 */
export async function handleRecipesApi(m, parts, query, body, state, userId, findUser) {
  ensureMealsRecipesState(state);
  const method = m.toUpperCase();

  const recipeId = Number(parts[1]);

  if (recipeId && parts[2] === 'to-shopping-list' && method === 'POST') {
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) throw apiError('Recipe not found.', 404);
    const ingredients = state.recipe_ingredients.filter((i) => i.recipe_id === recipeId);
    const listId = body?.list_id || state.shopping_lists[0]?.id;
    if (!listId) throw apiError('No shopping list.', 400);
    const added = addIngredientsToShoppingList(state, ingredients, listId, userId);
    await saveState();
    return { data: { added } };
  }

  if (method === 'GET' && !parts[1]) {
    const data = state.recipes
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => enrichRecipe(r, state, findUser));
    return { data };
  }

  if (method === 'POST' && !parts[1]) {
    const id = nextId();
    const title = String(body.title || '').trim();
    if (!title) throw apiError('Title is required.', 400);
    const recipe = {
      id,
      title,
      notes: body.notes ?? null,
      recipe_url: body.recipe_url ?? null,
      meal_types: normalizeMealTypes(body.meal_types).join(','),
      created_by: userId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.recipes.push(recipe);
    replaceRecipeIngredients(state, id, body.ingredients);
    await saveState();
    return { data: enrichRecipe(recipe, state, findUser) };
  }

  if (recipeId && method === 'PUT') {
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) throw apiError('Recipe not found.', 404);
    if (body.title !== undefined) recipe.title = String(body.title).trim();
    if (body.notes !== undefined) recipe.notes = body.notes;
    if (body.recipe_url !== undefined) recipe.recipe_url = body.recipe_url;
    if (body.meal_types !== undefined) recipe.meal_types = normalizeMealTypes(body.meal_types).join(',');
    if (body.ingredients !== undefined) replaceRecipeIngredients(state, recipeId, body.ingredients);
    recipe.updated_at = nowIso();
    await saveState();
    return { data: enrichRecipe(recipe, state, findUser) };
  }

  if (recipeId && method === 'DELETE') {
    state.recipe_ingredients = state.recipe_ingredients.filter((i) => i.recipe_id !== recipeId);
    state.recipes = state.recipes.filter((r) => r.id !== recipeId);
    await saveState();
    return { ok: true };
  }

  return null;
}
