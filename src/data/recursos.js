// Contactos y pasos para reclamar que se muestran en /recursos.
//
// Revisa estos datos de vez en cuando: los teléfonos y las direcciones de los
// organismos cambian. Última comprobación: 18/09/2026.
//
// Formato:
//   PASOS_RECLAMACION -> [{ title, text }]
//   RECURSOS          -> [{ icon, title, intro, items: [{ label, phone, url, detail }] }]
// El campo `icon` tiene que ser uno de los nombres de src/utils/icons.js.
// De cada `item` solo `label` es obligatorio; `phone`, `url` y `detail` son opcionales.

export const PASOS_RECLAMACION = [
  {
    title: 'Reúne las pruebas',
    text: 'Haz fotos con fecha, apunta la calle y el número exactos y describe desde cuándo ocurre. Si ya lo has publicado en el foro, ese enlace te vale como resumen ordenado con los apoyos de otros vecinos.',
  },
  {
    title: 'Averigua de quién depende',
    text: 'Alumbrado, aceras, limpieza, parques y ruido suelen ser del Ayuntamiento. El agua y el alcantarillado, del Canal de Isabel II. Los autobuses interurbanos y el Metro, del Consorcio de Transportes. Si lo reclamas al organismo equivocado pierdes semanas.',
  },
  {
    title: 'Da el aviso rápido',
    text: 'Para lo urgente o sencillo, una llamada al 010 o al teléfono de averías basta y queda registrada. Pide siempre el número de aviso y apúntalo.',
  },
  {
    title: 'Presenta la reclamación por escrito',
    text: 'El aviso telefónico no deja rastro suficiente si luego hay que insistir. Presenta una instancia general en la sede electrónica con tu certificado digital o Cl@ve, o en persona en el Registro pidiendo cita previa. Adjunta las fotos.',
  },
  {
    title: 'Guarda el justificante y publícalo',
    text: 'Al registrar la instancia te dan un número de registro. Añádelo a tu publicación con «Cambiar estado → En trámite»: así todo el barrio puede seguir el expediente y nadie duplica la misma reclamación.',
  },
  {
    title: 'Si no contestan, insiste y escala',
    text: 'La Administración tiene que responder. Pasados tres meses sin respuesta puedes reiterar la instancia citando el número de registro anterior, llevarlo al Pleno a través de un grupo municipal, o presentar una queja ante el Defensor del Pueblo, que es gratuita y no necesita abogado.',
  },
];

export const RECURSOS = [
  {
    icon: 'shield',
    title: 'Urgencias',
    intro: 'Para cuando hay riesgo para las personas. No uses el foro para esto: llama.',
    items: [
      {
        label: 'Emergencias (todas)',
        phone: '112',
        detail: 'Bomberos, sanitarias, policía. Funciona desde cualquier teléfono, las 24 horas.',
      },
      {
        label: 'Policía Local de Leganés',
        phone: '092',
        detail: 'Desde fuera del municipio o desde un móvil, 912 489 092. Disponible las 24 horas.',
      },
      {
        label: 'Policía Nacional',
        phone: '091',
      },
      {
        label: 'Guardia Civil',
        phone: '062',
      },
    ],
  },
  {
    icon: 'building',
    title: 'Ayuntamiento de Leganés',
    intro: 'Alumbrado, aceras y calzadas, limpieza, basuras, parques y zonas infantiles, ruido, tráfico, obras y licencias.',
    items: [
      {
        label: 'Atención al ciudadano (010)',
        phone: '912 489 010',
        detail: 'Desde Leganés también marcando 010. Recoge avisos, sugerencias y reclamaciones de los servicios municipales. Pide el número de aviso.',
      },
      {
        label: 'Sede electrónica: instancia general y trámites',
        url: 'https://sede.leganes.org',
        detail: 'Abierta 24 horas. Necesitas certificado digital, DNI electrónico o Cl@ve. Es la vía que deja constancia por escrito.',
      },
      {
        label: 'Web municipal',
        url: 'https://www.leganes.org',
        detail: 'Direcciones, teléfonos y horarios de todos los servicios municipales.',
      },
      {
        label: 'Policía Local · unidad administrativa',
        detail: 'Calle Chile, 1. Metro San Nicasio. Atestados de tráfico: 912 489 379.',
      },
    ],
  },
  {
    icon: 'settings',
    title: 'Suministros y transporte',
    intro: 'Servicios que no dependen del Ayuntamiento, aunque la avería esté en la calle.',
    items: [
      {
        label: 'Canal de Isabel II · averías y atención',
        phone: '900 365 365',
        url: 'https://www.canaldeisabelsegunda.es',
        detail: 'Agua y alcantarillado. Las averías se atienden a cualquier hora. Ten a mano el número de contrato.',
      },
      {
        label: 'Consorcio Regional de Transportes',
        url: 'https://www.crtm.es',
        detail: 'Autobuses, Metro y Cercanías: frecuencias, paradas, incidencias y reclamaciones.',
      },
      {
        label: 'Avería eléctrica o de gas',
        detail: 'El teléfono de urgencias viene en tu factura y es el de la distribuidora, no el de la comercializadora. Si el problema es una farola apagada en la calle, eso sí es del Ayuntamiento.',
      },
    ],
  },
  {
    icon: 'globe',
    title: 'Comunidad de Madrid',
    intro: 'Sanidad, educación, vivienda, consumo y carreteras autonómicas.',
    items: [
      {
        label: 'Atención al ciudadano (012)',
        phone: '012',
        detail: 'Información y registro de trámites de la Comunidad de Madrid.',
      },
      {
        label: 'Portal de la Comunidad de Madrid',
        url: 'https://www.comunidad.madrid',
      },
      {
        label: 'Hoja de reclamaciones de consumo',
        detail: 'Cualquier comercio o empresa de servicios está obligado a tenerla. También se puede presentar en la Oficina Municipal de Información al Consumidor (OMIC) a través del 010.',
      },
    ],
  },
  {
    icon: 'file',
    title: 'Si no te contestan',
    intro: 'Cuando la reclamación lleva meses parada y no hay respuesta.',
    items: [
      {
        label: 'Defensor del Pueblo',
        url: 'https://www.defensordelpueblo.es',
        detail: 'Supervisa a todas las administraciones. Presentar una queja es gratis y no hace falta abogado ni procurador.',
      },
      {
        label: 'Grupos municipales',
        detail: 'Cualquier grupo del Pleno puede registrar una pregunta o una moción sobre un asunto del barrio. Sus datos de contacto están en la web municipal.',
      },
      {
        label: 'El informe de este foro',
        detail: 'En «Informe» tienes las incidencias abiertas con sus apoyos, fechas y números de registro. Se imprime o se descarga en PDF y CSV para llevarlo al Ayuntamiento, al Pleno o a los medios.',
      },
    ],
  },
];
