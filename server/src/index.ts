import crypto from 'node:crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import cron, { ScheduledTask } from 'node-cron';
import { FirebaseAdminContext, initializeFirebaseAdmin } from './firebaseAdmin';
import {
  computeISTDateString,
  generateForDate,
  parseValidatedDateString,
} from './jobs/dailyDoseLogs';
import { processDueDoses } from './jobs/dueDosesEscalation';

export interface CreateAppOptions {
  adminContext?: FirebaseAdminContext;
  jobsActive?: boolean;
  cronSecret?: string;
}

function constantTimeSecretMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function createApp(options: CreateAppOptions = {}): express.Application {
  const adminContext = options.adminContext ?? initializeFirebaseAdmin();
  const jobsActive = options.jobsActive ?? process.env.ENABLE_INTERNAL_CRON === 'true';

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      jobsActive,
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

  return app;
}

export function startInternalCron(adminContext: FirebaseAdminContext): ScheduledTask[] {
  const dailyTask = cron.schedule(
    '30 18 * * *',
    () => {
      if (!adminContext.isInitialized || !adminContext.db) {
        console.warn('[cron] Skipping generate-daily-logs: Firestore not initialized');
        return;
      }
      const targetDate = computeISTDateString(new Date());
      void generateForDate(adminContext.db, targetDate)
        .then((result) => {
          console.info(
            `[cron] generate-daily-logs completed for ${result.targetDate}: created=${result.createdCount}, skipped=${result.skippedCount}`
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[cron] generate-daily-logs failed: ${message}`);
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

  return [dailyTask, dueCheckTask];
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
