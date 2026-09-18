import crypto from 'node:crypto';
import { CATEGORY_SEED } from '../utils/constants.js';
import { uniqueSlug } from '../utils/text.js';

/**
 * Crea las categorías, el primer administrador y (opcionalmente) contenido de
 * ejemplo. Es idempotente: se puede ejecutar en cada arranque.
 */
export function runSeed(db, services, config) {
  ensureCategories(db);
  services.categories.invalidate();
  const adminCreated = ensureAdmin(services.users, config);
  let demoCreated = false;
  if (config.seedDemo && !db.prepare("SELECT value FROM settings WHERE key = 'demo_seeded'").get()) {
    const count = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
    if (count === 0) {
      seedDemo(db, services);
      demoCreated = true;
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seeded', '1')").run();
  }
  let demoBusinesses = false;
  if (config.seedDemo && !db.prepare("SELECT value FROM settings WHERE key = 'demo_businesses_seeded'").get()) {
    if (db.prepare('SELECT COUNT(*) AS c FROM businesses').get().c === 0) {
      seedDemoBusinesses(db, services);
      demoBusinesses = true;
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_businesses_seeded', '1')").run();
  }
  return { adminCreated, demoCreated, demoBusinesses };
}

/** Atajo para escribir horarios: h('09:00-14:00', '17:00-20:30') o h() para cerrado. */
function h(...tramos) {
  const ranges = tramos.filter(Boolean).map((t) => t.split('-'));
  return { closed: ranges.length === 0, ranges };
}

function seedDemoBusinesses(db, services) {
  const owners = db.prepare('SELECT id, name FROM users WHERE is_demo = 1 ORDER BY id').all();
  if (!owners.length) return;
  const ownerFor = (i) => owners[i % owners.length].id;

  const laborable = (m, t) => [h(m, t), h(m, t), h(m, t), h(m, t), h(m, t)];

  const data = [
    {
      name: 'Panadería La Espiga (ejemplo)',
      category: 'panaderia',
      shortDesc: 'Pan artesano y bollería hecha cada mañana en el barrio.',
      description: 'Llevamos más de veinte años amasando en Vereda de los Estudiantes. Pan de masa madre, hogazas, empanadas y bollería casera. Encargos por teléfono para grupos y comuniones.',
      address: 'Calle de Cáceres, 14',
      lat: 40.31998, lng: -3.75470,
      phone: '916 00 11 22', whatsapp: '+34 600 111 222',
      hours: [...laborable('07:00-14:00', '17:00-20:30'), h('07:30-14:30'), h()],
      offers: [
        { type: 'oferta', title: 'Barra de masa madre a 1,20 € por las tardes', body: 'De lunes a viernes a partir de las 19:00, el pan del día a precio especial hasta agotar existencias.', priceText: '1,20 €', endsDays: 20 },
        { type: 'novedad', title: 'Ya tenemos pan sin gluten los jueves', body: 'Por encargo hasta el miércoles a mediodía. Elaborado en obrador separado.', endsDays: 45 },
      ],
    },
    {
      name: 'Bar Casa Nino (ejemplo)',
      category: 'bar',
      shortDesc: 'Menú del día casero, tapas y terraza en la plaza.',
      description: 'Cocina de siempre a precio de barrio. Menú del día de lunes a viernes con primero, segundo, postre y bebida. Los fines de semana, tapas y raciones para compartir en la terraza.',
      address: 'Plaza Comunidad de Madrid, 3',
      lat: 40.32705, lng: -3.75760,
      phone: '916 00 33 44', instagram: 'casanino.ejemplo',
      hours: [h(), ...laborable('07:00-16:30', '19:00-23:30').slice(1), h('09:00-00:30'), h('09:00-17:00')],
      offers: [
        { type: 'oferta', title: 'Menú del día a 11,50 € con postre casero', body: 'De lunes a viernes de 13:00 a 16:00. Cinco primeros y cinco segundos a elegir, pan, bebida y postre o café.', priceText: '11,50 €', endsDays: 60 },
        { type: 'evento', title: 'Partido en pantalla grande y cerveza con tapa', body: 'Abrimos antes del partido. Reserva mesa por teléfono, se llena pronto.', startDays: 3, time: '21:00' },
      ],
    },
    {
      name: 'Frutería El Huerto (ejemplo)',
      category: 'alimentacion',
      shortDesc: 'Fruta y verdura de temporada, de mercado a tu mesa.',
      description: 'Compramos cada madrugada en Mercamadrid. Producto de temporada, verdura de la huerta y reparto gratuito a domicilio en el barrio para pedidos de más de 20 euros.',
      address: 'Calle de Oviedo, 8',
      lat: 40.32090, lng: -3.75630,
      phone: '916 00 55 66', whatsapp: '+34 600 555 666',
      hours: [...laborable('09:00-14:00', '17:30-20:30'), h('09:00-15:00'), h()],
      offers: [
        { type: 'oferta', title: 'Caja de temporada de 5 kg por 9,90 €', body: 'Fruta variada de temporada. Encarga por WhatsApp y te la preparamos para recoger.', priceText: '9,90 €', endsDays: 7 },
      ],
    },
    {
      name: 'Peluquería Tijeras (ejemplo)',
      category: 'peluqueria',
      shortDesc: 'Peluquería de barrio para toda la familia, con y sin cita.',
      description: 'Corte, color y tratamientos. Precios especiales para menores de doce años y personas mayores de lunes a jueves.',
      address: 'Calle de Salamanca, 21',
      lat: 40.32040, lng: -3.75380,
      phone: '916 00 77 88',
      hours: [h(), h('10:00-14:00', '16:30-20:00'), h('10:00-14:00', '16:30-20:00'), h('10:00-14:00', '16:30-20:00'), h('10:00-20:00'), h('09:30-15:00'), h()],
      offers: [
        { type: 'oferta', title: 'Martes y miércoles, corte para mayores de 65 años a 8 €', priceText: '8 €', endsDays: 90 },
      ],
    },
    {
      name: 'Librería Papel y Tinta (ejemplo)',
      category: 'papeleria',
      shortDesc: 'Libros, material escolar y encargos en veinticuatro horas.',
      description: 'Librería y papelería del barrio. Pedidos de cualquier título en veinticuatro horas sin recargo, material escolar por listas de colegio y club de lectura mensual.',
      address: 'Avenida de la Lengua Española, 12',
      lat: 40.32450, lng: -3.75290,
      phone: '916 00 99 00', website: 'https://www.ejemplo.es', instagram: 'papelytinta.ejemplo',
      hours: [...laborable('09:30-13:30', '17:00-20:00'), h('10:00-14:00'), h()],
      offers: [
        { type: 'evento', title: 'Club de lectura: encuentro con la autora', body: 'Presentación y coloquio abierto a todo el barrio. Entrada libre hasta completar aforo.', startDays: 10, time: '19:00' },
        { type: 'novedad', title: 'Ya recogemos las listas de material escolar', body: 'Tráenos la lista del colegio y te preparamos el pedido completo.', endsDays: 30 },
      ],
    },
  ];

  /* Catálogo de ejemplo. Sin fotos: se ven con la tarjeta de relleno hasta que
     cada negocio suba las suyas, que es justo lo que queremos animar a hacer. */
  const productos = {
    'Panadería La Espiga (ejemplo)': [
      ['Hogaza de masa madre', '3,20 € la pieza', 'Fermentación lenta de 24 horas.', 1],
      ['Barra rústica', '1,40 €', '', 0],
      ['Empanada de atún', '2,50 € la ración', 'Masa casera, recién hecha cada mañana.', 1],
      ['Croissant de mantequilla', '1,60 €', '', 0],
      ['Tarta de queso', '18 € entera, por encargo', '', 0],
    ],
    'Bar Casa Nino (ejemplo)': [
      ['Tortilla de patata', '2,80 € el pincho', 'Jugosa, con cebolla.', 1],
      ['Croquetas caseras de jamón', '9 € la ración', '', 1],
      ['Bocadillo de calamares', '4,50 €', '', 0],
      ['Menú del día', '11,50 €', 'Primero, segundo, pan, bebida y postre.', 0],
    ],
    'Frutería El Huerto (ejemplo)': [
      ['Tomate de temporada', '2,90 € el kilo', '', 1],
      ['Naranja de zumo', '1,50 € el kilo', 'Saco de 10 kilos por 12 €.', 1],
      ['Fresa de Huelva', '3,20 € la bandeja', '', 0],
      ['Verdura para caldo', '2,40 € la bolsa', 'Preparada al momento.', 0],
    ],
    'Peluquería Tijeras (ejemplo)': [
      ['Corte de caballero', '12 €', '', 0],
      ['Corte y peinado', '18 €', '', 1],
      ['Color completo', 'desde 35 €', 'Incluye lavado y secado.', 0],
    ],
    'Librería Papel y Tinta (ejemplo)': [
      ['Novedades de narrativa', '', 'Pregunta por las recomendaciones del mes.', 1],
      ['Mochila escolar', 'desde 24 €', '', 0],
      ['Lote de material escolar', '32 € el lote', 'Preparado según la lista del colegio.', 1],
      ['Álbum de fotos artesanal', '15 €', '', 0],
    ],
  };

  const insertProduct = db.prepare(
    `INSERT INTO business_products (business_id, name, price_text, description, is_featured, sort_order, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );

  const insertOffer = db.prepare(
    `INSERT INTO business_offers (business_id, type, title, body, price_text, starts_on, ends_on, event_time, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?))`
  );

  db.transaction(() => {
    data.forEach((b, i) => {
      const business = services.businesses.create(
        {
          name: b.name, category: b.category, shortDesc: b.shortDesc, description: b.description,
          address: b.address, lat: b.lat, lng: b.lng, phone: b.phone || '', whatsapp: b.whatsapp || '',
          email: '', website: b.website || '', instagram: b.instagram || '', facebook: '', hours: b.hours,
        },
        ownerFor(i),
        { status: 'activo' }
      );
      db.prepare('UPDATE businesses SET is_demo = 1, views = ? WHERE id = ?').run(20 + Math.floor(Math.random() * 90), business.id);
      (productos[b.name] || []).forEach(([nombre, precio, desc, destacado], k) => {
        insertProduct.run(business.id, nombre, precio || null, desc || null, destacado, k);
      });
      for (const o of b.offers || []) {
        const start = o.startDays != null ? `+${o.startDays} days` : null;
        insertOffer.run(
          business.id, o.type, o.title, o.body || null, o.priceText || null,
          start ? isoOffset(db, start) : null,
          o.endsDays != null ? isoOffset(db, `+${o.endsDays} days`) : start ? isoOffset(db, start) : null,
          o.time || null,
          `-${1 + Math.floor(Math.random() * 5)} days`
        );
      }
    });
  })();
}

function isoOffset(db, modifier) {
  return db.prepare("SELECT date('now', ?) AS d").get(modifier).d;
}

function ensureCategories(db) {
  const insert = db.prepare(
    'INSERT INTO categories (slug, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING'
  );
  db.transaction(() => {
    CATEGORY_SEED.forEach((c, i) => insert.run(c.slug, c.name, c.icon, c.color, i));
  })();
}

function ensureAdmin(users, config) {
  if (users.count() > 0) return null;
  const password = config.admin.password || generatePassword();
  users.create({ name: 'Administración', email: config.admin.email, password, role: 'admin' });
  return { email: config.admin.email, password, generated: !config.admin.password };
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function seedDemo(db, services) {
  const cat = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug).id;
  const demoUsers = [
    { name: 'Marta (vecina de ejemplo)', firstName: 'Marta', lastName: 'Gómez Ruiz', phone: '600 10 10 10', email: 'marta.ejemplo@vereda.local' },
    { name: 'Luis (vecino de ejemplo)', firstName: 'Luis', lastName: 'Fernández Soto', phone: '600 20 20 20', email: 'luis.ejemplo@vereda.local' },
    { name: 'Carmen (vecina de ejemplo)', firstName: 'Carmen', lastName: 'Vidal Peña', phone: '600 30 30 30', email: 'carmen.ejemplo@vereda.local' },
    { name: 'Asociación vecinal (ejemplo)', firstName: 'Asociación', lastName: 'Vecinal', phone: '600 40 40 40', email: 'asociacion.ejemplo@vereda.local' },
  ].map((u) => services.users.create({ ...u, password: generatePassword(), isDemo: true }));
  const [marta, luis, carmen, asoc] = demoUsers;

  const posts = [
    {
      type: 'incidencia', category: 'alumbrado', author: marta, status: 'abierta', daysAgo: 3, supports: 14,
      title: 'Tres farolas fundidas en la calle de Cáceres desde hace semanas',
      body: 'Las tres farolas del tramo entre los números 10 y 24 llevan apagadas desde principios de mes. Por la noche la acera queda completamente a oscuras y varias vecinas mayores han dejado de salir a esa hora.\n\nSe avisó por el 010 hace dos semanas y nos dieron un número de aviso, pero no ha venido nadie. ¿Alguien más lo ha comunicado?',
      location: 'Calle de Cáceres, 10-24', lat: 40.31995, lng: -3.75445, entity: 'Ayuntamiento de Leganés',
    },
    {
      type: 'incidencia', category: 'limpieza', author: luis, status: 'en_tramite', daysAgo: 12, supports: 27,
      title: 'Contenedores desbordados todos los fines de semana junto a la plaza',
      body: 'Los contenedores de la plaza se llenan el viernes por la tarde y no se vacían hasta el lunes. Las bolsas acaban en el suelo, con olores y presencia de ratas en verano.\n\nHemos presentado una reclamación por registro con fotos de tres fines de semana consecutivos. Adjuntamos el número de expediente por si alguien quiere sumarse.',
      location: 'Plaza Comunidad de Madrid', lat: 40.32712, lng: -3.75768, entity: 'Ayuntamiento de Leganés',
      reference: 'REG-2026-014382', claimDate: '2026-08-26',
      history: [{ to: 'en_tramite', note: 'Reclamación presentada por registro electrónico. Nos han dado número de expediente.', by: 'luis', daysAgo: 10 }],
    },
    {
      type: 'incidencia', category: 'tramites', author: asoc, status: 'abierta', daysAgo: 6, supports: 31,
      title: 'Más de tres semanas de espera para conseguir cita previa en el Registro',
      body: 'Varios vecinos llevan intentando conseguir cita previa para presentar documentación en el Registro municipal y la primera fecha disponible está a más de tres semanas. Para trámites con plazo (ayudas, alegaciones, empadronamiento) esto supone perder el derecho.\n\nProponemos recoger casos concretos aquí para trasladarlos a Atención Ciudadana y al Pleno. Si te ha pasado, comenta con la fecha en que lo intentaste y la primera cita que te ofrecieron.',
      location: 'Oficinas municipales', lat: null, lng: null, entity: 'Ayuntamiento de Leganés',
    },
    {
      type: 'propuesta', category: 'trafico', author: carmen, status: 'abierta', daysAgo: 18, supports: 22,
      title: 'Pasos de peatones elevados y reductores de velocidad frente al colegio',
      body: 'A la hora de entrada y salida del colegio los coches pasan a mucha velocidad por la avenida. Ya ha habido dos sustos este curso.\n\nProponemos dos pasos de peatones elevados y señalización luminosa en el cruce. Es una actuación barata y en otros barrios ya se ha hecho.',
      location: 'Entorno del colegio', lat: 40.32310, lng: -3.75200, entity: 'Ayuntamiento de Leganés',
    },
    {
      type: 'incidencia', category: 'parques', author: marta, status: 'resuelta', daysAgo: 60, supports: 9, resolvedDaysAgo: 21,
      title: 'Bancos rotos y columpio sin asiento en la zona infantil',
      body: 'Dos bancos tienen los listones rotos con astillas y uno de los columpios lleva sin asiento desde la primavera. Los niños se suben igualmente a la estructura y es peligroso.',
      location: 'Zona infantil del parque', lat: 40.31760, lng: -3.75980, entity: 'Ayuntamiento de Leganés',
      history: [
        { to: 'en_tramite', note: 'Comunicado a través de la asociación vecinal en la reunión con el concejal de distrito.', by: 'asoc', daysAgo: 40 },
        { to: 'resuelta', note: 'Han sustituido los bancos y repuesto el asiento del columpio. ¡Gracias a todos los que apoyasteis!', by: 'marta', daysAgo: 21 },
      ],
    },
    {
      type: 'incidencia', category: 'calles', author: luis, status: 'abierta', daysAgo: 9, supports: 17,
      title: 'Aceras levantadas por las raíces de los árboles: varias caídas de personas mayores',
      body: 'En el paseo central las raíces han levantado las baldosas en al menos seis puntos. Ya conocemos tres caídas de personas mayores en el último mes, una con fractura de muñeca.\n\nPedimos una revisión completa del paseo y no solo parches puntuales.',
      location: 'Paseo central', lat: 40.32150, lng: -3.75620, entity: 'Ayuntamiento de Leganés',
    },
    {
      type: 'incidencia', category: 'ruido', author: carmen, status: 'en_tramite', daysAgo: 25, supports: 12,
      title: 'Obras nocturnas fuera del horario permitido en la avenida',
      body: 'Las obras de la avenida están trabajando con maquinaria pesada pasadas las 23:00 varios días a la semana. Hemos llamado a la Policía Local en dos ocasiones.\n\nSegún la ordenanza municipal de ruido, este tipo de trabajos tiene un horario limitado salvo autorización expresa. Hemos pedido por escrito que se nos informe si existe esa autorización.',
      location: 'Avenida principal', lat: 40.32480, lng: -3.75390, entity: 'Ayuntamiento de Leganés',
      reference: 'REG-2026-011907', claimDate: '2026-08-14',
      history: [{ to: 'en_tramite', note: 'Solicitud de información presentada. Plazo legal de respuesta: un mes.', by: 'carmen', daysAgo: 24 }],
    },
    {
      type: 'pregunta', category: 'obras', author: marta, status: 'abierta', daysAgo: 2, supports: 6,
      title: '¿Alguien sabe cuándo empiezan por fin las obras del centro cultural del barrio?',
      body: 'Llevamos años oyendo que el centro cultural está a punto de empezar. Se anunció la licitación, pero no hemos visto ninguna máquina. ¿Alguien tiene información actualizada o ha preguntado en el Ayuntamiento?',
      location: 'Parcela del futuro centro cultural', lat: 40.31880, lng: -3.75080, entity: 'Ayuntamiento de Leganés',
    },
    {
      type: 'aviso', category: 'agua', author: asoc, status: 'cerrada', daysAgo: 35, supports: 4,
      title: 'Corte de agua programado el jueves de 9:00 a 14:00 (ejemplo de aviso)',
      body: 'El Canal de Isabel II ha comunicado un corte de suministro por trabajos de mejora en la red. Afecta a las calles del sector norte. Se recomienda almacenar agua para las horas del corte.',
      location: 'Sector norte del barrio', lat: 40.32800, lng: -3.75700, entity: 'Canal de Isabel II',
      history: [{ to: 'cerrada', note: 'El corte ya se ha producido. Aviso cerrado.', by: 'asoc', daysAgo: 33 }],
    },
    {
      type: 'incidencia', category: 'seguridad', author: luis, status: 'abierta', daysAgo: 1, supports: 8,
      title: 'Pintadas y cristales rotos en el paso subterráneo, sin luz por la noche',
      body: 'El paso subterráneo hacia la estación está lleno de pintadas, hay cristales rotos en el suelo y la mitad de las luces no funcionan. Mucha gente prefiere dar un rodeo por la carretera, que es más peligroso.',
      location: 'Paso subterráneo', lat: 40.31550, lng: -3.75330, entity: 'Ayuntamiento de Leganés',
    },
  ];

  const byKey = { marta, luis, carmen, asoc };
  const insertPost = db.prepare(`
    INSERT INTO posts (slug, type, title, body, category_id, author_id, status, location_text, lat, lng,
      responsible_entity, official_reference, official_claim_date, is_demo, views, support_count,
      created_at, updated_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now', ?), datetime('now', ?), CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)
  `);
  const insertHistory = db.prepare(
    "INSERT INTO status_history (post_id, from_status, to_status, note, changed_by, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))"
  );
  const insertComment = db.prepare(
    "INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, datetime('now', ?))"
  );

  db.transaction(() => {
    const ids = [];
    for (const p of posts) {
      const info = insertPost.run(
        uniqueSlug(p.title), p.type, p.title, p.body, cat(p.category), p.author.id, p.status,
        p.location, p.lat, p.lng, p.entity, p.reference ?? null, p.claimDate ?? null,
        20 + Math.floor(Math.random() * 120), p.supports,
        `-${p.daysAgo} days`, `-${p.daysAgo} days`,
        p.resolvedDaysAgo ?? null, p.resolvedDaysAgo != null ? `-${p.resolvedDaysAgo} days` : null
      );
      const postId = Number(info.lastInsertRowid);
      ids.push(postId);
      insertHistory.run(postId, null, 'abierta', null, p.author.id, `-${p.daysAgo} days`);
      let from = 'abierta';
      for (const h of p.history ?? []) {
        insertHistory.run(postId, from, h.to, h.note, byKey[h.by].id, `-${h.daysAgo} days`);
        from = h.to;
      }
    }
    const comments = [
      [0, luis, 'Yo también lo avisé por el 010 el día 20. Me dieron el número de aviso 20260820-4471. Lo apunto aquí por si sirve para reclamar.', 2],
      [0, carmen, 'Mi madre vive en el 18 y ya no baja a tirar la basura por la noche. Esto no puede seguir así.', 1],
      [1, marta, 'Los sábados por la mañana es imposible pasar por ahí. Me sumo a la reclamación.', 9],
      [1, asoc, 'Hemos pedido reunión con el concejal de distrito para tratar este tema y el de la limpieza general. Os iremos informando.', 5],
      [2, carmen, 'Yo lo intenté el 28 de agosto y la primera cita era para el 22 de septiembre. Tenía que presentar unas alegaciones con plazo y tuve que hacerlo por correo certificado.', 4],
      [3, luis, 'Totalmente de acuerdo. Añadiría un paso de cebra en la salida del parking, que también es un punto negro.', 15],
      [5, marta, 'Mi vecina del tercero se cayó ahí la semana pasada. Ha puesto una reclamación patrimonial. Si alguien necesita el modelo, que me escriba.', 6],
      [7, asoc, 'En la última reunión nos dijeron que la licitación estaba "a punto". Hemos pedido la fecha por escrito.', 1],
    ];
    for (const [idx, author, body, daysAgo] of comments) {
      insertComment.run(ids[idx], author.id, body, `-${daysAgo} days`);
    }
    db.prepare(
      'UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id AND comments.is_hidden = 0)'
    ).run();
  })();
}
