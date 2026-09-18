import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

let sharpModule = null;
async function loadSharp() {
  if (sharpModule !== null) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch (err) {
    console.warn('[fotos] sharp no disponible, las imágenes se guardarán sin optimizar:', err.message);
    sharpModule = false;
  }
  return sharpModule;
}

export function createUploader(config) {
  const maxBytes = config.upload.maxMb * 1024 * 1024;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: config.upload.maxImages, fields: 40 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED.has(file.mimetype)) return cb(null, true);
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    },
  });

  /** Crea una instancia de multer con un número máximo de ficheros propio. */
  function instance(maxFiles) {
    return multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes, files: maxFiles, fields: 400 },
      fileFilter: (req, file, cb) => {
        if (ALLOWED.has(file.mimetype)) return cb(null, true);
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      },
    });
  }

  /** Middleware: parsea el formulario multipart y traduce errores a un mensaje amable en req.uploadError. */
  function images(field = 'imagenes', maxFiles = config.upload.maxImages) {
    const handler = instance(maxFiles).array(field, maxFiles);
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) {
          req.files = req.files || [];
          req.uploadError = friendlyMessage(err, config, maxFiles);
        }
        next();
      });
    };
  }

  /** Acepta ficheros con nombres de campo dinámicos, como una foto por fila de una tabla. */
  function anyFiles(maxFiles = 40) {
    const handler = instance(maxFiles).any();
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) {
          req.files = req.files || [];
          req.uploadError = friendlyMessage(err, config, maxFiles);
        }
        next();
      });
    };
  }

  /** Igual que images(), pero con varios campos de fichero a la vez (logo, portada, galería). */
  function fields(defs) {
    const handler = upload.fields(defs);
    return (req, res, next) => {
      handler(req, res, (err) => {
        if (err) {
          req.files = req.files || {};
          req.uploadError = friendlyMessage(err, config);
        }
        next();
      });
    };
  }

  /** Recorta y guarda una sola imagen con unas medidas concretas. Devuelve { filename, thumb }. */
  async function storeOne(file, { width = 1200, height = 800, fit = 'cover', thumb = null } = {}) {
    if (!file) return null;
    const sharp = await loadSharp();
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
    if (!sharp) {
      const ext = ALLOWED.get(file.mimetype) || 'bin';
      const filename = `${id}.${ext}`;
      await fs.writeFile(path.join(config.uploadsDir, filename), file.buffer);
      return { filename, thumb: filename };
    }
    const filename = `${id}.jpg`;
    await sharp(file.buffer)
      .rotate()
      .resize({ width, height, fit, position: 'attention', withoutEnlargement: fit !== 'cover' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(path.join(config.uploadsDir, filename));
    if (!thumb) return { filename, thumb: filename };
    const thumbName = `${id}_t.jpg`;
    await sharp(file.buffer)
      .rotate()
      .resize({ width: thumb.width, height: thumb.height, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(config.uploadsDir, thumbName));
    return { filename, thumb: thumbName };
  }

  /** Procesa las fotos subidas (recorte a 1600px, miniatura, JPEG) y las guarda en disco. */
  async function store(files) {
    const sharp = await loadSharp();
    const result = [];
    for (const file of files || []) {
      const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
      if (sharp) {
        const filename = `${id}.jpg`;
        const thumb = `${id}_t.jpg`;
        const main = await sharp(file.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toFile(path.join(config.uploadsDir, filename));
        await sharp(file.buffer)
          .rotate()
          .resize({ width: 640, height: 480, fit: 'cover', position: 'attention' })
          .jpeg({ quality: 78, mozjpeg: true })
          .toFile(path.join(config.uploadsDir, thumb));
        result.push({ filename, thumb, width: main.width, height: main.height });
      } else {
        const ext = ALLOWED.get(file.mimetype) || 'bin';
        const filename = `${id}.${ext}`;
        await fs.writeFile(path.join(config.uploadsDir, filename), file.buffer);
        result.push({ filename, thumb: filename, width: null, height: null });
      }
    }
    return result;
  }

  async function remove(filenames) {
    for (const name of filenames.filter(Boolean)) {
      const safe = path.basename(name);
      await fs.rm(path.join(config.uploadsDir, safe), { force: true });
    }
  }

  return { images, anyFiles, fields, store, storeOne, remove };
}

function friendlyMessage(err, config, maxFiles = config.upload.maxImages) {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return `Cada foto puede pesar como máximo ${config.upload.maxMb} MB.`;
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return `Puedes subir hasta ${maxFiles} fotos en formato JPG, PNG o WebP.`;
      default:
        return 'No se han podido procesar las fotos. Inténtalo de nuevo.';
    }
  }
  return 'No se han podido procesar las fotos. Inténtalo de nuevo.';
}
