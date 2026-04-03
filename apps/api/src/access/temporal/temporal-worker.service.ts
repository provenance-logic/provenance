import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NativeConnection, Worker } from '@temporalio/worker';
import { join } from 'path';
import { getConfig } from '../../config.js';
import { AccessRequestEntity } from '../entities/access-request.entity.js';
import { ApprovalEventEntity } from '../entities/approval-event.entity.js';
import { createApprovalActivities } from './approval.activities.js';

export const APPROVAL_TASK_QUEUE = 'access-approval';

@Injectable()
export class TemporalWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalWorkerService.name);
  private connection: NativeConnection | null = null;
  private worker: Worker | null = null;

  constructor(
    @InjectRepository(AccessRequestEntity)
    private readonly requestRepo: Repository<AccessRequestEntity>,
    @InjectRepository(ApprovalEventEntity)
    private readonly eventRepo: Repository<ApprovalEventEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = getConfig();
    try {
      this.connection = await NativeConnection.connect({
        address: config.TEMPORAL_ADDRESS,
      });

      const activities = createApprovalActivities({
        requestRepo: this.requestRepo,
        eventRepo: this.eventRepo,
      });

      this.worker = await Worker.create({
        connection: this.connection,
        namespace: config.TEMPORAL_NAMESPACE,
        // Points to the compiled workflow file. __dirname resolves correctly in both
        // ts-jest (src/) and production builds (dist/).
        workflowsPath: join(__dirname, 'approval.workflow.js'),
        activities,
        taskQueue: APPROVAL_TASK_QUEUE,
      });

      // Run non-blocking — the worker processes tasks in the background.
      void this.worker.run();
      this.logger.log('Temporal approval worker started');
    } catch (err) {
      // Log and continue — the app can serve read-only traffic even if Temporal is down.
      this.logger.error('Failed to start Temporal approval worker', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.worker?.shutdown();
      await this.connection?.close();
      this.logger.log('Temporal approval worker shut down');
    } catch (err) {
      this.logger.error('Error shutting down Temporal worker', err);
    }
  }
}
