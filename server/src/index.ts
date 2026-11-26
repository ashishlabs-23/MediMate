import crypto from 'node:crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import * as admin from 'firebase-admin';
import cron, { ScheduledTask } from 'node-cron';
import { FirebaseAdminContext, initializeFirebaseAdmin } from './firebaseAdmin';
import {
  computeDateStringInTimezone,
  computeISTDateString,
  generateForDate,
  getActivePatientTimezones,
  isMidnightHourInTimezone,
  parseValidatedDateString,
} from './jobs/dailyDoseLogs';
import { processDueDoses } from './jobs/dueDosesEscalation';
import { closeMissedDoses } from './jobs/eodMissedCloseout';

export interface CreateAppOptions {
  adminContext?: FirebaseAdminContext;
  db?: admin.firestore.Firestore | null;
  messaging?: admin.messaging.Messaging | null;
  isInitialized?: boolean;
  jobsActive?: boolean;
  cronSecret?: string;
}

export interface MidnightTimezoneCycleResult {
  midnightTimezones: string[];
  closedCount: number;
  skippedCloseCount: number;
  createdCount: number;
  skippedLogCount: number;
}

function constantTimeSecretMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Runs the per-timezone midnight cycle: collects active patient timezones,
 * filters to those currently in local hour 00, closes past-midnight doses to
 * 'missed', and generates today's dose logs for each midnight local date.
 */
export async function runMidnightTimezoneCycle(
  db: admin.firestore.Firestore,
  now: Date = new Date()
): Promise<MidnightTimezoneCycleResult> {
  const distinctTimezones = await getActivePatientTimezones(db);
  const midnightTimezones = distinctTimezones.filter((tz) =>
    isMidnightHourInTimezone(now, tz)
  );

  if (midnightTimezones.length === 0) {
    return {
      midnightTimezones: [],
      closedCount: 0,
      skippedCloseCount: 0,
      createdCount: 0,
      skippedLogCount: 0,
    };
  }

  const closeResult = await closeMissedDoses(db, now, {
    targetTimezones: new Set(midnightTimezones),
  });

  const timezonesByDate = new Map<string, Set<string>>();
  for (const tz of midnightTimezones) {
    const localDate = computeDateStringInTimezone(now, tz);
    let tzSet = timezonesByDate.get(localDate);
    if (!tzSet) {
      tzSet = new Set<string>();
      timezonesByDate.set(localDate, tzSet);
    }
    tzSet.add(tz);
  }

  let createdCount = 0;
  let skippedLogCount = 0;
  for (const [localDate, tzSet] of timezonesByDate.entries()) {
    const genResult = await generateForDate(db, localDate, {
      targetTimezones: tzSet,
    });
    createdCount += genResult.createdCount;
    skippedLogCount += genResult.skippedCount;
  }

  return {
    midnightTimezones,
    closedCount: closeResult.closedCount,
    skippedCloseCount: closeResult.skippedCount,
    createdCount,
    skippedLogCount,
  };
}

export function createApp(options: CreateAppOptions = {}): express.Application {
  const adminContext: FirebaseAdminContext = options.adminContext
    ? options.adminContext
    : options.db !== undefined ||
        options.messaging !== undefined ||
        options.isInitialized !== undefined
      ? {
          app: null,
          db: options.db ?? null,
          messaging: options.messaging ?? null,
          isInitialized: options.isInitialized ?? Boolean(options.db),
        }
      : initializeFirebaseAdmin();
  const jobsActive = options.jobsActive ?? process.env.ENABLE_INTERNAL_CRON === 'true';

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      name: 'MediMate Automation Backend',
      status: 'operational',
      uptime: process.uptime(),
      jobsActive,
      firebaseInitialized: adminContext.isInitialized,
      healthCheck: '/health',
      endpoints: [
        '/health',
        '/ping',
        '/api/jobs/generate-daily-logs',
        '/api/jobs/check-due-doses',
        '/api/jobs/close-missed-doses',
      ],
      documentation: 'https://github.com/ashishlabs-23/MediMate',
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      jobsActive,
    });
  });

  app.get('/ping', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
    });
  });

  const requireCronSecret = (req: Request, res: Response, next: NextFunction): void => {
    const expectedSecret =
      options.cronSecret !== undefined ? options.cronSecret : process.env.CRON_SECRET;
    const providedSecret = req.header('x-cron-secret');

    if (
      !expectedSecret ||
      typeof providedSecret !== 'string' ||
      !constantTimeSecretMatches(providedSecret, expectedSecret)
    ) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };

  app.post('/api/jobs/generate-daily-logs', requireCronSecret, async (req: Request, res: Response) => {
    if (!adminContext.isInitialized || !adminContext.db) {
      res.status(503).json({ error: 'Firestore Admin SDK is not initialized' });
      return;
    }

    let targetDate: string;
    const rawTargetDate = (req.body as { targetDate?: unknown } | undefined)?.targetDate;
    if (rawTargetDate !== undefined) {
      if (typeof rawTargetDate !== 'string') {
        res.status(400).json({ error: 'Invalid targetDate: expected YYYY-MM-DD string' });
        return;
      }
      try {
        parseValidatedDateString(rawTargetDate);
        targetDate = rawTargetDate;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid targetDate';
        res.status(400).json({ error: message });
        return;
      }
    } else {
      targetDate = computeISTDateString(new Date());
    }

    try {
      const result = await generateForDate(adminContext.db, targetDate);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] generate-daily-logs failed: ${message}`);
      res.status(500).json({ error: 'Failed to generate daily dose logs' });
    }
  });

  app.post('/api/jobs/check-due-doses', requireCronSecret, async (_req: Request, res: Response) => {
    if (!adminContext.isInitialized || !adminContext.db) {
      res.status(503).json({ error: 'Firestore Admin SDK is not initialized' });
      return;
    }

    try {
      const result = await processDueDoses(
        adminContext.db,
        new Date(),
        adminContext.messaging
      );
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] check-due-doses failed: ${message}`);
      res.status(500).json({ error: 'Failed to check due doses' });
    }
  });

  app.post('/api/jobs/close-missed-doses', requireCronSecret, async (_req: Request, res: Response) => {
    if (!adminContext.isInitialized || !adminContext.db) {
      res.status(503).json({ error: 'Firestore Admin SDK is not initialized' });
      return;
    }

    try {
      const result = await closeMissedDoses(adminContext.db, new Date());
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] close-missed-doses failed: ${message}`);
      res.status(500).json({ error: 'Failed to close missed doses' });
    }
  });

  return app;
}

export function startInternalCron(adminContext: FirebaseAdminContext): ScheduledTask[] {
  const midnightCycleTask = cron.schedule(
    '0,30 * * * *',
    () => {
      if (!adminContext.isInitialized || !adminContext.db) {
        console.warn('[cron] Skipping midnight-timezone-cycle: Firestore not initialized');
        return;
      }
      void runMidnightTimezoneCycle(adminContext.db, new Date())
        .then((result) => {
          if (result.midnightTimezones.length > 0) {
            console.info(
              `[cron] midnight-timezone-cycle completed for [${result.midnightTimezones.join(', ')}]: closed=${result.closedCount}, created=${result.createdCount}, skippedLogs=${result.skippedLogCount}`
            );
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[cron] midnight-timezone-cycle failed: ${message}`);
        });
    },
    { timezone: 'UTC' }
  );

  const dueCheckTask = cron.schedule(
    '*/5 * * * *',
    () => {
      if (!adminContext.isInitialized || !adminContext.db) {
        console.warn('[cron] Skipping check-due-doses: Firestore not initialized');
        return;
      }
      void processDueDoses(adminContext.db, new Date(), adminContext.messaging)
        .then((result) => {
          console.info(
            `[cron] check-due-doses completed: initial=${result.initialReminderIds.length}, gentle=${result.gentleReminderIds.length}, escalated=${result.escalatedIds.length}`
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[cron] check-due-doses failed: ${message}`);
        });
    },
    { timezone: 'UTC' }
  );

  return [midnightCycleTask, dueCheckTask];
}

function startServer(): void {
  dotenv.config();

  const adminContext = initializeFirebaseAdmin();
  const enableCron = process.env.ENABLE_INTERNAL_CRON === 'true';

  if (enableCron) {
    startInternalCron(adminContext);
  }

  const app = createApp({
    adminContext,
    jobsActive: enableCron,
  });

  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.info(
      `[server] MediMate backend listening on port ${port} (firebaseInitialized=${adminContext.isInitialized}, jobsActive=${enableCron})`
    );
  });
}

if (require.main === module) {
  startServer();
}
