import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { KafkaJSError } from 'kafkajs';
import { ConnectionReferenceOutboxPublisher } from '../connection-reference-outbox.publisher.js';
import { KafkaProducerService } from '../../kafka/kafka-producer.service.js';

// The publisher's correctness contract:
//
//   1. Empty queue → no Kafka calls, no UPDATE, no errors.
//   2. Unpublished rows → each row published in id-ASC order, all rows
//      then marked published in a single UPDATE, all inside one
//      transaction.
//   3. Partition key on every publish is the row's org_id (broker
//      partition routing per ADR-007).
//   4. A publish failure inside the loop throws — the transaction
//      callback rejects so TypeORM rolls back, and no UPDATE fires.
//      Next tick will see the same rows and retry (at-least-once).
//
// The transaction wrapper and `em.query` are mocked because the
// publisher is the integration point — we are testing what it
// orchestrates, not what PostgreSQL does. Integration coverage of the
// SQL itself is end-to-end (the seed runs prove the table exists and
// that ConsentService writes to it).

describe('ConnectionReferenceOutboxPublisher', () => {
  let publisher: ConnectionReferenceOutboxPublisher;
  let kafkaProducer: { publishStrict: jest.Mock };
  let emQueryMock: jest.Mock;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    kafkaProducer = { publishStrict: jest.fn().mockResolvedValue(undefined) };

    // The publisher passes a single callback to dataSource.transaction.
    // We invoke the callback with a fake EntityManager that exposes only
    // the `query` method (the publisher only uses raw query).
    emQueryMock = jest.fn();
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({ query: emQueryMock })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConnectionReferenceOutboxPublisher,
        { provide: KafkaProducerService, useValue: kafkaProducer },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    publisher = moduleRef.get(ConnectionReferenceOutboxPublisher);
  });

  function mockSelect(rows: Array<{ id: string; org_id: string; event_type: string; payload: Record<string, unknown> }>): void {
    emQueryMock.mockReset();
    // First call: SELECT FOR UPDATE SKIP LOCKED returns the rows.
    // Second call (if it happens): UPDATE published_at — resolves to undefined.
    emQueryMock.mockResolvedValueOnce(rows);
    emQueryMock.mockResolvedValueOnce(undefined);
  }

  describe('drain', () => {
    it('is a no-op when no unpublished rows exist', async () => {
      mockSelect([]);

      const published = await publisher.drain();

      expect(published).toBe(0);
      expect(kafkaProducer.publishStrict).not.toHaveBeenCalled();
      // Only the SELECT runs — no UPDATE.
      expect(emQueryMock).toHaveBeenCalledTimes(1);
    });

    it('publishes a single unpublished row and marks it published', async () => {
      mockSelect([
        {
          id: '1',
          org_id: 'org-a',
          event_type: 'connection_reference.state',
          payload: { newState: 'active', referenceId: 'ref-1' },
        },
      ]);

      const published = await publisher.drain();

      expect(published).toBe(1);
      expect(kafkaProducer.publishStrict).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.publishStrict).toHaveBeenCalledWith(
        'connection_reference.state',
        'org-a',
        { newState: 'active', referenceId: 'ref-1' },
      );
      // The second em.query call is the UPDATE — id 1 should be in the array.
      // /s flag for dotall so . spans newlines in the multi-line SQL.
      expect(emQueryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/UPDATE.*published_at = NOW/s),
        [['1']],
      );
    });

    it('publishes a batch of rows in id-ascending order with one UPDATE at the end', async () => {
      mockSelect([
        { id: '1', org_id: 'org-a', event_type: 'connection_reference.state', payload: { a: 1 } },
        { id: '2', org_id: 'org-b', event_type: 'connection_reference.state', payload: { b: 2 } },
        { id: '3', org_id: 'org-a', event_type: 'connection_reference.state', payload: { c: 3 } },
      ]);

      const published = await publisher.drain();

      expect(published).toBe(3);
      expect(kafkaProducer.publishStrict).toHaveBeenCalledTimes(3);
      // Ordering of publish calls: 1, 2, 3.
      expect(kafkaProducer.publishStrict.mock.calls[0][2]).toEqual({ a: 1 });
      expect(kafkaProducer.publishStrict.mock.calls[1][2]).toEqual({ b: 2 });
      expect(kafkaProducer.publishStrict.mock.calls[2][2]).toEqual({ c: 3 });
      // One UPDATE marks every published row.
      expect(emQueryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/UPDATE/s),
        [['1', '2', '3']],
      );
    });

    it('uses the row org_id as the Kafka partition key for every publish', async () => {
      mockSelect([
        { id: '1', org_id: 'org-alpha', event_type: 'connection_reference.state', payload: {} },
        { id: '2', org_id: 'org-beta', event_type: 'connection_reference.state', payload: {} },
      ]);

      await publisher.drain();

      expect(kafkaProducer.publishStrict.mock.calls[0][1]).toBe('org-alpha');
      expect(kafkaProducer.publishStrict.mock.calls[1][1]).toBe('org-beta');
    });

    it('rolls back the transaction when a publish fails — UPDATE never fires, drain re-throws', async () => {
      mockSelect([
        { id: '1', org_id: 'org-a', event_type: 'connection_reference.state', payload: {} },
        { id: '2', org_id: 'org-a', event_type: 'connection_reference.state', payload: {} },
      ]);
      // Second publish throws the same KafkaJSError the strict path
      // re-throws when the broker is unreachable.
      kafkaProducer.publishStrict
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new KafkaJSError('broker down'));

      await expect(publisher.drain()).rejects.toThrow('broker down');

      // SELECT ran (call 1); UPDATE did NOT run (no call 2).
      expect(emQueryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('tick', () => {
    it('calls drain and swallows errors so the cron keeps running', async () => {
      const drainSpy = jest
        .spyOn(publisher, 'drain')
        .mockRejectedValueOnce(new Error('transient'));

      // tick must not throw — the cron loop must not be killed by one
      // bad tick. The error is logged; we just confirm it doesn't bubble.
      await expect(publisher.tick()).resolves.toBeUndefined();
      expect(drainSpy).toHaveBeenCalledTimes(1);
    });

    it('completes normally when drain resolves', async () => {
      const drainSpy = jest.spyOn(publisher, 'drain').mockResolvedValueOnce(0);

      await expect(publisher.tick()).resolves.toBeUndefined();
      expect(drainSpy).toHaveBeenCalledTimes(1);
    });
  });
});
