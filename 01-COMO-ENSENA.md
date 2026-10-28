# 01 — Cómo enseña este mentor

El objetivo no es reconocer palabras sino poder explicar, predecir y diagnosticar. Ese cambio se
hace **de a una capa**, no de golpe. Esta página explica el orden en que están escritos los
documentos y qué podés pedirle al mentor cuando algo no cierra. module-builder escribe cada módulo
siguiendo estas mismas reglas.

## La secuencia

Cada concepto nuevo aparece en este orden:

```text
1. intuición            ¿qué problema hay?
2. modelo mínimo        la versión más chica que sea correcta
3. puente               algo que ya conocés (si existe)
4. ejemplo pequeño      código o salida mínima
5. mecanismo real       qué pasa de verdad
6. nombre técnico       recién ahora, la palabra
7. detalles internos    cuando hagan falta
8. excepciones          al final
```

Si en algún documento ves un nombre técnico antes de entender para qué existe, es un defecto del
documento: pedile al mentor que retroceda una capa.

## Los puentes son guías, no traducciones

Los puentes salen de lo que ya sabés, y eso está escrito en tu perfil (`course/00-PERFIL.md`, lo arma
module-builder con vos). Si venís de JavaScript y aprendés Python, por ejemplo:

- una lista de Python se parece a un array de JavaScript;
- un diccionario se parece a un objeto literal;
- `pip` cumple un papel parecido al de `npm`.

Pero hay ideas que **no tienen equivalente** en lo que ya conocés. En esos casos el documento lo dice
("acá no hay puente") y construye el modelo desde cero, en vez de forzar una analogía que después
tengas que desaprender.

Cuando un puente sí se usa, el documento también dice **dónde deja de valer**: una lista de Python
no se comporta como un array de JavaScript cuando la comparás con `==` o la querés usar como clave
de un diccionario.

## Simplificar, y avisar que se simplificó

Al principio los modelos son deliberadamente simples. Cuando una frase es una simplificación, lo vas
a ver marcado:

> **Simplificación:** por ahora pensá que el sistema operativo ejecuta tu programa directamente.

Más adelante, el documento que la corrige lo dice explícitamente ("en realidad…"). Una
simplificación sin corrección posterior es un error.

## Diagramas que crecen

Un diagrama no aparece completo de entrada. Empieza con tres cajas y suma una caja cuando aparece la
pregunta que esa caja responde:

```text
código → compilador → programa
```

después:

```text
código → compilador → código objeto → linker → ejecutable
```

y recién mucho más tarde:

```text
código → preprocesador → compilador → ensamblador → objeto → linker → ejecutable → loader → proceso
```

## Checkpoints

Después de cada capa importante vas a encontrar:

> **Hasta acá, quedate con esto:** 3 a 5 relaciones simples.

Si no podés explicar esos puntos con tus palabras, no sigas: volvé una capa.

## Escalera de profundidad

Los conceptos grandes tienen niveles. Para usar algo alcanza con los primeros; para diagnosticarlo
hacen falta los siguientes. Ejemplo con git:

| Nivel | Qué sabés |
| --- | --- |
| L0 | guarda versiones de tus archivos |
| L1 | commits, ramas y merge en el día a día |
| L2 | rebase, conflictos y remotos |
| L3 | objetos, refs y el índice |
| L4 | reflog, recuperar lo "perdido" |
| L5 | packfiles, transporte y hooks |

Cada módulo dice qué nivel necesitás. No hace falta L5 para hacer tu primer commit.

## Eslabones

Cada módulo termina con la pregunta que deja abierta, y esa pregunta es la que responde el módulo
siguiente. Si llegás a un tema y no sabés por qué existe, falta un eslabón: buscalo en la referencia
local o pedíselo al mentor.

## Teoría conectada con errores reales

Cada concepto dice qué errores empieza a explicar. La meta no es reconocer palabras sino
**predecir** qué va a fallar y dónde.

## Cómo pedir ayuda al mentor

| Te pasa | Pedí |
| --- | --- |
| "no entiendo" | que retroceda una capa y busque qué supuesto previo te falta; no que repita lo mismo con otras palabras |
| "¿por qué es tan complejo?" | que descomponga el sistema en sus piezas y diga qué hace cada una |
| aparece un nombre nuevo | qué problema resuelve, quién lo llama, qué recibe y qué produce |
| varias herramientas juntas | una tabla de "quién hace qué" |
| una explicación larguísima | que responda sólo la pregunta y ofrezca la siguiente capa |

La regla de fondo: **es mejor entender bien tres conceptos conectados que reconocer veinte
definiciones**.
