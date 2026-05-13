import { KafkaJSError } from 'kafkajs';
import { KafkaProducerService } from './kafka-producer.service.js';

// Focused tests for publishStrict — the new method that re-throws
// broker-unavailability errors instead of swallowing them. publishStrict
// exists so the Domain 12 outbox publisher can leave rows unpublished
// for retry rather than silently marking them delivered on broker
// outage.
//
// We do not test the existing publish() method's success path here — the
// kafkajs Producer is constructed in the KafkaProducerService constructor
// and is integration territory. The diff this spec is paired with adds
// publishStrict, which is the single behavioral change.

describe('KafkaProducerService.publishStrict', () => {
  let service: KafkaProducerService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    // Construct the service then replace the private producer with a
    // mock. The constructor wires up kafkajs internals we do not want
    // to exercise — only the publish path matters here.
    service = new KafkaProducerService([]);
    sendMock = jest.fn();
    // Bypass the private modifier with a cast; mock injection is the
    // standard pattern for testing wrapper services like this.
    (service as unknown as { producer: { send: jest.Mock } }).producer = {
      send: sendMock,
    };
  });

  it('calls producer.send with the topic, key, and JSON-stringified value', async () => {
    sendMock.mockResolvedValueOnce(undefined);

    await service.publishStrict('connection_reference.state', 'org-a', {
      newState: 'active',
      refId: 'ref-1',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArg = sendMock.mock.calls[0][0];
    expect(sendArg.topic).toBe('connection_reference.state');
    expect(sendArg.messages).toHaveLength(1);
    expect(sendArg.messages[0].key).toBe('org-a');
    expect(JSON.parse(sendArg.messages[0].value)).toEqual({
      newState: 'active',
      refId: 'ref-1',
    });
  });

  it('re-throws KafkaJSError — the outbox publisher relies on this to roll back', async () => {
    const brokerDown = new KafkaJSError('broker unavailable');
    sendMock.mockRejectedValueOnce(brokerDown);

    await expect(
      service.publishStrict('connection_reference.state', 'org-a', {}),
    ).rejects.toBe(brokerDown);
  });

  it('re-throws non-KafkaJSError exceptions unchanged', async () => {
    const oddError = new Error('something else entirely');
    sendMock.mockRejectedValueOnce(oddError);

    await expect(
      service.publishStrict('connection_reference.state', 'org-a', {}),
    ).rejects.toBe(oddError);
  });
});
