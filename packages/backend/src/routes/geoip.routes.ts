import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { GEOIP_EDITIONS, type GeoIpEdition } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import { GeoIpError, MAX_UPLOAD_BYTES, type GeoIpService } from '../utils/geoip.js';

/**
 * The GeoIP database of the Connection Journal: what is installed, getting one (DB-IP's free
 * Lite databases by download, or a file of the admin's own by upload) and the two switches.
 * Mounted under /api/connection-journal/geoip, behind the admin check.
 */
export const geoIpRoutes: Router = Router();

const geo = (req: Request): GeoIpService => req.app.locals.geoIp as GeoIpService;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = geo(req as Request).uploadDir;
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, 'upload.tmp'),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// GET /api/connection-journal/geoip - what is installed, what is going on
geoIpRoutes.get('/', (req: Request, res: Response) => {
  res.json(geo(req).status());
});

// PUT /api/connection-journal/geoip/settings - which DB-IP edition to fetch, and the monthly update
geoIpRoutes.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { edition, autoUpdate } = req.body ?? {};
    if (!(GEOIP_EDITIONS as readonly unknown[]).includes(edition)) throw new AppError(400, `edition must be one of: ${GEOIP_EDITIONS.join(', ')}`);
    if (typeof autoUpdate !== 'boolean') throw new AppError(400, 'autoUpdate must be a boolean');
    await geo(req).setSettings({ edition: edition as GeoIpEdition, autoUpdate });
    console.log(`[GeoIP] Settings updated by ${req.user?.username}: edition ${edition}, monthly update ${autoUpdate ? 'on' : 'off'}`);
    res.json(geo(req).status());
  } catch (err) { next(err); }
});

// POST /api/connection-journal/geoip/download - fetch DB-IP's current file in the background; the status shows the progress
geoIpRoutes.post('/download', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = geo(req);
    const requested = req.body?.edition;
    if (requested !== undefined && !(GEOIP_EDITIONS as readonly unknown[]).includes(requested)) {
      throw new AppError(400, `edition must be one of: ${GEOIP_EDITIONS.join(', ')}`);
    }
    if (service.busy) throw new AppError(409, 'A GeoIP download or installation is already running');
    const edition = (requested ?? service.status().selectedEdition) as GeoIpEdition;
    console.log(`[GeoIP] Download of the ${edition} database requested by ${req.user?.username}`);
    // Not waited for: the download takes a while and the page polls the status. A failure is kept in the status.
    void service.download(edition).catch(() => undefined);
    res.status(202).json(service.status());
  } catch (err) { next(err); }
});

// POST /api/connection-journal/geoip/upload - a database file of the admin's own (an .mmdb, or gzipped)
geoIpRoutes.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, async (uploadError: unknown) => {
    const tmp = req.file?.path;
    try {
      if (uploadError) {
        if ((uploadError as { code?: string }).code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'The file is too large', code: 'too-large' });
          return;
        }
        throw uploadError;
      }
      if (!req.file || !tmp) throw new AppError(400, 'No file was sent (field "file")');
      const service = geo(req);
      if (service.busy) {
        fs.rmSync(tmp, { force: true });
        throw new AppError(409, 'A GeoIP download or installation is already running');
      }
      await service.installUpload(tmp, path.basename(req.file.originalname));
      console.log(`[GeoIP] A database file was uploaded by ${req.user?.username}: ${path.basename(req.file.originalname)}`);
      res.json(service.status());
    } catch (err) {
      if (tmp) fs.rmSync(tmp, { force: true });
      if (err instanceof GeoIpError) {
        res.status(400).json({ error: err.detail, code: err.code });
        return;
      }
      next(err);
    }
  });
});

// DELETE /api/connection-journal/geoip - remove the database (what was looked up stays in the journal)
geoIpRoutes.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = geo(req);
    if (service.busy) throw new AppError(409, 'A GeoIP download or installation is running');
    await service.remove();
    console.log(`[GeoIP] The database was removed by ${req.user?.username}`);
    res.json(service.status());
  } catch (err) { next(err); }
});
