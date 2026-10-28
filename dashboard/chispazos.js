// What Chispa says when you tap her: mostly jokes, sometimes a fact. pickChispazo decides:
// 30% a fact about the learner's current stage, 5% a fact about any stage, the rest a joke.
// The jokes are the core's. The facts are the course's: each stage may list a few short, checkable
// ones in the "facts" field of its module.json. When there are none, a joke takes their place.

export const QUIPS = [
  '¡Bzzzt! Cosquillas de alto voltaje ⚡',
  'Me puse los lentes porque tu futuro brilla demasiado 😎',
  '1,21 gigawatts… mentira, funciono con 5 voltios y entusiasmo.',
  '¿Sabías que soy 100% energía renovable? Me recargo con tus commits.',
  'Dato: un rayo dura 0,2 s. Un TODO_LEARNER sin tocar, ¡semanas! Vamos ⚡',
  'Hoy no hay cortocircuitos, hay chispazos de genialidad.',
  'Si me tocás de nuevo me enchufo a tu cargador del celular 🔌',
  '¿Por qué el electrón no se pelea nunca? Porque siempre busca el camino de menor resistencia.',
  'Mi signo es Rayo, ascendente Corriente Continua ♒⚡',
  'No tengo bugs: tengo features de alto voltaje.',
  'Un neutrón entra a un bar y pregunta cuánto sale. "Para vos, sin carga."',
  '¿Cómo se despide un capacitor? "Me descargo y me voy."',
  'Tranqui, los tests también tienen días malos. Sobre todo los lunes.',
  'Si el build tarda, aprovechá: estirá, tomá agua y volvé con voltaje ⚡',
  '"Funciona en mi máquina." Bueno, entonces publicamos tu máquina 📦',
  'Hay 10 tipos de personas: las que entienden binario y las que no.',
  '¿Qué le dijo el front al back? "Tenemos que hablar… pero en JSON, por favor."',
  'Me dijeron que tengo mucha energía. Gracias, es potencial y cinética.',
  'Borrar la caché no es terapia, pero a veces ayuda 😅',
  'Ohm sweet Ohm 🏠⚡',
  'Un amperio entra a una fiesta: "¿Está todo en serie o puedo ir en paralelo?"',
  'Mi comida favorita: bytes al ajillo con salsa de bits.',
  'Error 418: soy una tetera. Mentira, soy una chispa ☕⚡',
  'Leer el primer error del log es como prender la luz: todo lo demás se ve mejor.',
];

const pick = items => items[Math.floor(Math.random() * items.length)];
const factsOf = module => (Array.isArray(module?.facts) ? module.facts.filter(fact => typeof fact === 'string' && fact.trim()) : []);

// modules: the catalog's stages, each with its optional facts; currentId: the learner's current stage.
export function pickChispazo(modules = [], currentId = null, roll = Math.random()) {
  const current = factsOf(modules.find(module => module.id === currentId));
  if (roll < 0.30 && current.length) return `Dato de ${currentId} ⚡ ${pick(current)}`;
  if (roll >= 0.30 && roll < 0.35) {
    const withFacts = modules.filter(module => factsOf(module).length);
    if (withFacts.length) {
      const module = pick(withFacts);
      return `Dato de ${module.id} ⚡ ${pick(factsOf(module))}`;
    }
  }
  return pick(QUIPS);
}
