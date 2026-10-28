# 08 — Qué publicar y qué no

Cada review termina con la misma pregunta: **¿qué de este módulo es publicable?** Esta página da el
criterio para responderla.

## Qué es

Un criterio explícito para decidir si algo que hiciste puede ser público. Se resume en tres
preguntas que se responden **en orden**:

1. **¿Es mío para publicar?**
2. **¿Expone a alguien?**
3. **¿Le sirve a otra persona?**

Si la 1 o la 2 fallan, no se publica (o se reescribe hasta que pasen). La 3 decide si vale la pena
el esfuerzo.

## Por qué existe

Publicar tiene costos asimétricos. Un buen post suma de a poco; un error (una clave filtrada, datos
de un paciente, código de tu empleador) puede costarte el trabajo, una multa o la confianza de quien
te iba a contratar, y no se puede deshacer: internet guarda copias. Un criterio escrito evita decidir
«a ojo» cuando estás apurado o entusiasmado.

## Las tres preguntas en detalle

### 1. ¿Es mío para publicar?

| Situación | Normalmente |
| --- | --- |
| Código y datos que creaste en tu tiempo, con tus equipos y datos públicos | tuyo |
| Código que escribiste para tu empleador o un cliente | **del empleador o cliente**, aunque lo hayas escrito vos |
| Lo que aprendiste en el trabajo (conceptos, patrones) reescrito desde cero con datos sintéticos | tuyo, sin nombres internos ni detalles confidenciales |
| Capturas de herramientas internas, dashboards o tickets | del empleador |
| Datasets descargados | depende de su licencia: leela |
| Modelos o librerías de terceros | depende de su licencia: algunas prohíben uso comercial o redistribución |

Leé tu contrato: muchos contratos de trabajo en tecnología incluyen cláusulas de propiedad
intelectual que alcanzan incluso lo que hacés fuera de horario, si se relaciona con el negocio. Si
hay duda, pedí permiso por escrito.

### 2. ¿Expone a alguien?

Expone a alguien todo lo que permita identificar a una persona o revelar algo privado de ella:
nombres, emails, fotos de caras, voces, ubicaciones, historiales médicos, conversaciones,
identificadores de dispositivos. También expone a tu empleador cualquier detalle interno:
arquitectura no pública, nombres de clientes, métricas de negocio, vulnerabilidades.

### 3. ¿Le sirve a otra persona?

Un repo con «hola mundo» no suma. Sirve lo que tiene algo que sólo vos tenés: una medición propia,
un error y su solución, una comparación honesta, una explicación más clara que las existentes.

## Checklist de publicación

- [ ] No hay datos personales ni de salud, ni siquiera «anonimizados» a mano.
- [ ] No hay código, datos, capturas ni nombres internos de un empleador o cliente.
- [ ] No hay claves, tokens, contraseñas ni `.env` en el repo **ni en su historial**.
- [ ] Los datasets, imágenes y modelos usados tienen licencia que permite publicar el resultado.
- [ ] Las afirmaciones están respaldadas por mediciones reproducibles, con hardware y versiones.
- [ ] Hay una sección de limitaciones.
- [ ] Lo revisé con la cabeza fría (al menos unas horas después de terminarlo).

## Ejemplos

1. **Un benchmark de tu propio proyecto con datos públicos.** Es tuyo, no expone a nadie y le sirve
   a otros. Publicar.
2. **«Así optimizamos el servicio del trabajo».** El código y los datos no son tuyos. Opción:
   reproducí la idea con datos públicos y código propio, sin nombres internos, y publicá *eso*. Si
   querés mencionar a la empresa, pedí permiso.
3. **Una captura de tu app con datos de prueba que parecen reales.** Revisá que realmente sean
   ficticios; si no estás seguro, generá datos claramente falsos («Persona Ejemplo», fechas
   imposibles).
4. **Algo construido sobre una librería o un modelo con licencia no comercial.** Podés publicar el
   método y los números; quizás no el artefacto. Leé la licencia.

## Errores comunes

| Síntoma | Causa | Corrección |
| --- | --- | --- |
| «Le saqué el nombre, ya está anonimizado» | otros campos permiten reidentificar | usá datos sintéticos o públicos |
| Publicaste algo del trabajo «porque es genérico» | el código sigue siendo del empleador | reescribilo desde cero sin nada interno, o pedí permiso |
| Usaste imágenes de internet en un dataset publicado | sin licencia | datasets con licencia explícita (CC-BY, CC0, etc.) |
| Una clave quedó en un commit viejo | borrarla del archivo no la saca del historial | revocala ya y reescribí el historial antes de publicar |

## Comprobá que lo entendiste

1. Escribiste un script en tu horario laboral para tu empleador, y es genérico. ¿Lo podés publicar?
2. Tenés un dataset sin nombres, pero con edad, sexo, fecha de un estudio médico y hospital. ¿Es
   seguro publicarlo?
3. ¿En qué orden se responden las tres preguntas, y por qué?

## Respuestas

1. Por defecto, no: es trabajo para tu empleador. Necesitás permiso escrito, o reescribirlo desde
   cero fuera del trabajo y sin nada interno.
2. No: la combinación de edad, sexo, fecha y hospital puede identificar a una persona. Además, los
   datos de salud tienen protección legal especial.
3. Primero «¿es mío?» y «¿expone a alguien?», porque si fallan no importa cuán útil sea. «¿Le sirve
   a otro?» sólo decide si vale la pena el esfuerzo.

## Para ampliar (opcional)

- choosealicense.com (licencias de software).
- Creative Commons: tipos de licencias para datos e imágenes.
