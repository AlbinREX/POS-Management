import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, raw, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { AppModule } from './app.module';
import { MEDIA_LIMIT_BYTES } from './media/media.service';
import { ErrorFilter, logger } from './security';
import { getConfig } from './config';
import type { ApiRequest } from './auth/authorization';
export async function createApp() {
  const config = getConfig();
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.TRUST_PROXY === '1' ? 1 : false);
  app.use((req: ApiRequest, res: Response, next: NextFunction) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () =>
      logger.info(
        { requestId: req.requestId, method: req.method, status: res.statusCode },
        'HTTP request',
      ),
    );
    next();
  });
  app.use(helmet());
  const rateHandler = (req: Request, res: Response) =>
    res.status(429).json({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      requestId: (req as ApiRequest).requestId,
    });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: rateHandler,
    }),
  );
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 60000,
      limit: 15,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: rateHandler,
    }),
  );
  app.use(
    '/api/auth/refresh',
    rateLimit({
      windowMs: 60000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: rateHandler,
    }),
  );
  app.use(
    '/api/auth/password',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: rateHandler,
    }),
  );
  app.use((req: ApiRequest, res: Response, next: NextFunction) => {
    // Require exact Origin on all mutations, including login, to stop login CSRF.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin !== config.APP_ORIGIN
    ) {
      res.status(403).json({
        statusCode: 403,
        code: 'ORIGIN_REJECTED',
        message: 'Request origin rejected',
        requestId: req.requestId,
      });
      return;
    }
    next();
  });
  // Menu image uploads arrive as the raw file, on this one route only. The declared
  // content type is not trusted: the media service identifies the format from the bytes.
  app.use('/api/media/menu', raw({ type: () => true, limit: MEDIA_LIMIT_BYTES }));
  app.use(json({ limit: '32kb' }));
  app.use((error: unknown, req: ApiRequest, res: Response, next: NextFunction) => {
    if (
      error instanceof Error &&
      'type' in error &&
      ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))
    ) {
      const tooLarge = error.type === 'entity.too.large';
      const image = req.path.startsWith('/api/media/');
      res.status(tooLarge ? 413 : 400).json({
        statusCode: tooLarge ? 413 : 400,
        code: tooLarge ? 'BODY_TOO_LARGE' : 'INVALID_JSON',
        message: tooLarge
          ? image
            ? 'Images must be 5 MB or smaller'
            : 'Request body is too large'
          : 'Invalid JSON body',
        requestId: req.requestId,
      });
      return;
    }
    next(error);
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
