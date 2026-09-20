import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, registerLimiter, registerAttemptsLimiter } from '../middleware/limits.js';
import { cleanString, isEmail, displayName, normalizePhone } from '../utils/text.js';
import { safePath, checkPassword } from '../utils/security.js';

/** Comprueba y limpia los datos personales del registro y del perfil. */
export function validateProfile(body) {
  const values = {
    firstName: cleanString(body.nombre, 40).replace(/\s+/g, ' '),
    lastName: cleanString(body.apellidos, 60).replace(/\s+/g, ' '),
    phone: normalizePhone(body.telefono),
  };
  const errors = [];
  const NAME_RE = /^[\p{L}][\p{L}\s'·-]{1,}$/u;
  if (!NAME_RE.test(values.firstName)) errors.push('Escribe tu nombre (solo letras, al menos dos).');
  if (!NAME_RE.test(values.lastName)) errors.push('Escribe tus apellidos (solo letras, al menos dos).');
  if (!cleanString(body.telefono, 30)) errors.push('Escribe tu número de teléfono.');
  else if (!values.phone) errors.push('El teléfono no es válido. Escribe nueve dígitos, por ejemplo 612 34 56 78.');
  return { values, errors };
}

const safeNext = (value) => safePath(value, '/');

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function destroy(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

export function authRoutes({ config, services }) {
  const router = express.Router();

  router.get('/registro', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('pages/register', { pageMeta: { title: 'Crear cuenta', noindex: true }, values: {}, errors: [], next: safeNext(req.query.next) });
  });

  router.post('/registro', registerAttemptsLimiter, registerLimiter, async (req, res) => {
    const { values: profile, errors } = validateProfile(req.body);
    const values = { ...profile, email: cleanString(req.body.email, 120).toLowerCase() };
    const password = String(req.body.contrasena || '');
    const password2 = String(req.body.contrasena2 || '');
    if (!isEmail(values.email)) errors.push('El correo electrónico no es válido.');
    const passwordError = checkPassword(password, { email: values.email, firstName: values.firstName, lastName: values.lastName });
    if (passwordError) errors.push(passwordError);
    if (password !== password2) errors.push('Las contraseñas no coinciden.');
    if (!req.body.normas) errors.push('Debes aceptar las normas de la comunidad.');
    if (!errors.length && services.users.findByEmail(values.email)) errors.push('Ya existe una cuenta con ese correo. ¿Quieres iniciar sesión?');
    const next = safeNext(req.body.next);
    if (errors.length) {
      return res.status(422).render('pages/register', { pageMeta: { title: 'Crear cuenta', noindex: true }, values, errors, next });
    }
    const user = services.users.create({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      email: values.email,
      password,
    });
    await regenerate(req);
    req.session.userId = user.id;
    services.users.touchLogin(user.id);
    req.flash('success', `¡Bienvenido/a, ${user.name}! Tu cuenta está lista.`);
    return res.redirect(next);
  });

  router.get('/acceder', (req, res) => {
    if (req.user) return res.redirect(safeNext(req.query.next));
    res.render('pages/login', { pageMeta: { title: 'Iniciar sesión', noindex: true }, values: {}, errors: [], next: safeNext(req.query.next) });
  });

  router.post('/acceder', loginLimiter, async (req, res) => {
    const email = cleanString(req.body.email, 120).toLowerCase();
    const password = String(req.body.contrasena || '');
    const next = safeNext(req.body.next);
    const user = await services.users.verify(email, password);
    if (!user) {
      return res.status(401).render('pages/login', {
        pageMeta: { title: 'Iniciar sesión', noindex: true },
        values: { email },
        errors: ['Correo o contraseña incorrectos.'],
        next,
      });
    }
    if (user.is_banned) {
      return res.status(403).render('pages/login', {
        pageMeta: { title: 'Iniciar sesión', noindex: true },
        values: { email },
        errors: ['Esta cuenta está bloqueada. Si crees que es un error, contacta con la administración del foro.'],
        next,
      });
    }
    await regenerate(req);
    req.session.userId = user.id;
    services.users.touchLogin(user.id);
    req.flash('success', `Hola de nuevo, ${user.name}.`);
    return res.redirect(next);
  });

  router.post('/salir', async (req, res) => {
    await destroy(req);
    res.clearCookie('vereda.sid');
    res.redirect('/');
  });

  router.get('/perfil', requireAuth, (req, res) => {
    const posts = services.posts.list({ authorId: req.user.id, includeHidden: true, perPage: 50 });
    res.render('pages/profile', {
      pageMeta: { title: 'Mi perfil', noindex: true },
      posts: posts.items,
      errors: [],
    });
  });

  router.post('/perfil/datos', requireAuth, (req, res) => {
    const { values, errors } = validateProfile(req.body);
    if (errors.length) {
      errors.forEach((e) => req.flash('error', e));
    } else {
      services.users.setProfile(req.user.id, values);
      req.flash('success', `Datos actualizados. En el foro apareces como «${displayName(values.firstName, values.lastName)}».`);
    }
    res.redirect('/perfil');
  });

  router.post('/perfil/contrasena', requireAuth, async (req, res) => {
    const current = String(req.body.actual || '');
    const password = String(req.body.contrasena || '');
    const password2 = String(req.body.contrasena2 || '');
    const passwordError = checkPassword(password, {
      email: req.user.email,
      firstName: req.user.first_name || '',
      lastName: req.user.last_name || '',
    });
    if (!(await services.users.verifyById(req.user.id, current))) {
      req.flash('error', 'La contraseña actual no es correcta.');
    } else if (passwordError) {
      req.flash('error', passwordError);
    } else if (password !== password2) {
      req.flash('error', 'Las contraseñas nuevas no coinciden.');
    } else {
      await services.users.setPassword(req.user.id, password);
      // El fichero con la contraseña inicial ya no sirve de nada una vez cambiada:
      // se borra solo, para que nadie tenga que acordarse.
      if (req.user.role === 'admin') await fs.rm(path.join(config.dataDir, 'PRIMER-ACCESO.txt'), { force: true });
      req.flash('success', 'Contraseña cambiada correctamente.');
    }
    res.redirect('/perfil');
  });

  return router;
}
