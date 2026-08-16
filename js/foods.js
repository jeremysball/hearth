// foods.js: curated first-foods catalog for the Solids feature.
// `icon` is a filename stem under assets/foods/<icon>.webp -- see a later
// task for how those assets are generated. A missing file falls back to the
// generic utensils icon at render time (js/solids-form.js), so this list
// can grow ahead of icon generation without breaking anything.
export const FOOD_CATALOG = [
  // Fruits
  { key: 'banana', label: 'Banana', group: 'Fruits', icon: 'banana' },
  { key: 'apple', label: 'Apple', group: 'Fruits', icon: 'apple' },
  { key: 'pear', label: 'Pear', group: 'Fruits', icon: 'pear' },
  { key: 'avocado', label: 'Avocado', group: 'Fruits', icon: 'avocado' },
  { key: 'blueberry', label: 'Blueberry', group: 'Fruits', icon: 'blueberry' },
  { key: 'strawberry', label: 'Strawberry', group: 'Fruits', icon: 'strawberry' },
  { key: 'mango', label: 'Mango', group: 'Fruits', icon: 'mango' },
  { key: 'peach', label: 'Peach', group: 'Fruits', icon: 'peach' },
  // Vegetables
  { key: 'sweet-potato', label: 'Sweet potato', group: 'Vegetables', icon: 'sweet-potato' },
  { key: 'carrot', label: 'Carrot', group: 'Vegetables', icon: 'carrot' },
  { key: 'broccoli', label: 'Broccoli', group: 'Vegetables', icon: 'broccoli' },
  { key: 'peas', label: 'Peas', group: 'Vegetables', icon: 'peas' },
  { key: 'green-beans', label: 'Green beans', group: 'Vegetables', icon: 'green-beans' },
  { key: 'zucchini', label: 'Zucchini', group: 'Vegetables', icon: 'zucchini' },
  { key: 'spinach', label: 'Spinach', group: 'Vegetables', icon: 'spinach' },
  { key: 'butternut-squash', label: 'Butternut squash', group: 'Vegetables', icon: 'butternut-squash' },
  // Grains / starches
  { key: 'oatmeal', label: 'Oatmeal', group: 'Grains & starches', icon: 'oatmeal' },
  { key: 'rice-cereal', label: 'Rice cereal', group: 'Grains & starches', icon: 'rice-cereal' },
  { key: 'bread', label: 'Bread', group: 'Grains & starches', icon: 'bread' },
  { key: 'pasta', label: 'Pasta', group: 'Grains & starches', icon: 'pasta' },
  // Proteins
  { key: 'chicken', label: 'Chicken', group: 'Proteins', icon: 'chicken' },
  { key: 'beef', label: 'Beef', group: 'Proteins', icon: 'beef' },
  { key: 'lentils', label: 'Lentils', group: 'Proteins', icon: 'lentils' },
  { key: 'tofu', label: 'Tofu', group: 'Proteins', icon: 'tofu' },
  { key: 'yogurt', label: 'Yogurt', group: 'Proteins', icon: 'yogurt' },
  // Common allergens
  { key: 'peanut-butter', label: 'Peanut butter', group: 'Common allergens', icon: 'peanut-butter' },
  { key: 'egg', label: 'Egg', group: 'Common allergens', icon: 'egg' },
  { key: 'cheese', label: 'Cheese (dairy)', group: 'Common allergens', icon: 'cheese' },
  { key: 'almond', label: 'Almond (tree nut)', group: 'Common allergens', icon: 'almond' },
  { key: 'wheat', label: 'Wheat', group: 'Common allergens', icon: 'wheat' },
  { key: 'soy', label: 'Soy', group: 'Common allergens', icon: 'soy' },
  { key: 'shrimp', label: 'Shrimp (shellfish)', group: 'Common allergens', icon: 'shrimp' },
  { key: 'sesame', label: 'Sesame', group: 'Common allergens', icon: 'sesame' },
];

export function findFoodByKey(key) {
  return FOOD_CATALOG.find((f) => f.key === key) || null;
}

export function groupedCatalog() {
  const groups = new Map();
  for (const f of FOOD_CATALOG) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}