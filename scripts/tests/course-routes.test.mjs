import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFor, routeModules, routeProgress, nextInRoute, validateRoutes} from '../../dashboard/course-routes.mjs';

const module = (id, depends = []) => ({id, depends});
const catalog = {
  defaultRoute: 'short',
  modules: [module('A00'), module('A01', ['A00']), module('A02', ['A01']), module('B00', ['A00'])],
  routes: [
    {id: 'short', modules: ['A00', 'A01']},
    {id: 'complete', modules: ['A00', 'A01', 'A02', 'B00']},
  ],
};
const doneState = ids => ({currentModule: ids.at(-1), modules: Object.fromEntries(ids.map(id => [id, {status: 'done'}]))});

test('routes are dependency-closed, unique and the complete route keeps every module', () => {
  assert.doesNotThrow(() => validateRoutes(catalog));
  assert.equal(routeFor(catalog, 'an-old-value-from-local-storage').id, 'short');
  for (const [patch, message] of [
    [{routes: [{id: 'short', modules: ['A01']}, catalog.routes[1]]}, /dependencias/],
    [{routes: [catalog.routes[0], {id: 'complete', modules: ['A00', 'A01']}]}, /complete/],
    [{routes: [catalog.routes[0], catalog.routes[0], catalog.routes[1]]}, /duplicada/],
    [{defaultRoute: 'missing'}, /predeterminada/],
    [{routes: [{id: 'short', modules: []}, catalog.routes[1]]}, /vacía/],
  ]) assert.throws(() => validateRoutes({...catalog, ...patch}), message);
});

test('an empty course is valid and every route helper answers nothing', () => {
  const empty = {defaultRoute: null, modules: [], routes: []};
  assert.doesNotThrow(() => validateRoutes(empty));
  assert.equal(routeFor(empty, 'complete'), null);
  assert.deepEqual(routeModules(empty, 'complete'), []);
  assert.deepEqual(routeProgress(empty, {modules: {}}, 'complete'), {done: 0, total: 0, percent: 0});
  assert.equal(nextInRoute(empty, {modules: {}}, 'complete'), null);
  assert.throws(() => validateRoutes({...empty, routes: [{id: 'complete', modules: ['X00']}], defaultRoute: 'complete'}), /inválida/);
});

test('progress and recommendations never unlock blocked modules or rewrite progress', () => {
  const state = {currentModule: 'A00', modules: {A00: {status: 'in_progress'}}};
  const baseline = structuredClone(state);
  assert.equal(nextInRoute(catalog, state, 'short'), null);
  assert.equal(routeProgress(catalog, state, 'short').percent, 0);
  assert.deepEqual(state, baseline);
  const short = doneState(['A00', 'A01']);
  assert.equal(routeProgress(catalog, short, 'short').percent, 100);
  assert.equal(nextInRoute(catalog, short, 'short'), null);
  assert.equal(nextInRoute(catalog, short, 'complete').id, 'A02');
  assert.equal(routeProgress(catalog, short, 'complete').percent, 50);
});
