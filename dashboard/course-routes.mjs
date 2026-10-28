// Shared by the dashboard and infrastructure tests; no DOM or state mutations.
// A course without modules has no routes; every function here answers "nothing" for it.
export function routeFor(catalog, id) {
  const routes = catalog.routes || [];
  return routes.find(route => route.id === id)
    || routes.find(route => route.id === catalog.defaultRoute)
    || routes[0]
    || null;
}

export function routeModules(catalog, id) {
  const route = routeFor(catalog, id);
  if (!route) return [];
  const byId = new Map(catalog.modules.map(module => [module.id, module]));
  return route.modules.map(moduleId => byId.get(moduleId)).filter(Boolean);
}

export function routeProgress(catalog, state, id) {
  const modules = routeModules(catalog, id);
  const done = modules.filter(module => state.modules[module.id]?.status === 'done').length;
  return {done, total: modules.length, percent: modules.length ? Math.round(done * 100 / modules.length) : 0};
}

export function nextInRoute(catalog, state, id) {
  return routeModules(catalog, id).find(module => module.id !== state.currentModule
    && state.modules[module.id]?.status !== 'done'
    && module.depends.every(dependency => state.modules[dependency]?.status === 'done')) || null;
}

export function validateRoutes(catalog) {
  const routes = catalog.routes || [];
  if (!catalog.modules.length && !routes.length) return;
  if (!routes.length || !routes.some(route => route.id === catalog.defaultRoute)) {
    throw new Error('Falta la ruta predeterminada (defaultRoute)');
  }
  const ids = new Set();
  const modules = new Map(catalog.modules.map(module => [module.id, module]));
  for (const route of routes) {
    if (typeof route?.id !== 'string' || !Array.isArray(route.modules)) throw new Error('Cada ruta necesita "id" y una lista "modules"');
    if (ids.has(route.id)) throw new Error(`Ruta duplicada: ${route.id}`);
    ids.add(route.id);
    const seen = new Set();
    if (!route.modules.length) throw new Error(`Ruta vacía: ${route.id}`);
    for (const id of route.modules) {
      const module = modules.get(id);
      if (!module || seen.has(id)) throw new Error(`${route.id}: etapa inválida o duplicada ${id}`);
      const missing = module.depends.filter(dependency => !seen.has(dependency));
      if (missing.length) throw new Error(`${route.id}/${id}: dependencias fuera de orden o ausentes ${missing.join(', ')}`);
      seen.add(id);
    }
  }
  const complete = routes.find(route => route.id === 'complete');
  if (!complete || complete.modules.length !== modules.size) throw new Error('El recorrido "complete" debe incluir todas las etapas');
}
