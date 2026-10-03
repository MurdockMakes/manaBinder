import test from "node:test";
import assert from "node:assert/strict";
import { broker, names } from "../src/broker.js";
test(
  "real RabbitMQ confirms, manual acknowledgement and dead-letter routing",
  { skip: !process.env.TEST_RABBITMQ_URL },
  async (t) => {
    const b = await broker(process.env.TEST_RABBITMQ_URL);
    t.after(() => b.close());
    await b.channel.purgeQueue(names.queue);
    await b.channel.purgeQueue(names.deadQueue);
    await b.publish({
      version: 1,
      type: "account.mail",
      mailId: "1",
      eventId: "1",
      correlationId: "broker-test",
    });
    const message = await b.channel.get(names.queue, { noAck: false });
    assert.ok(message);
    assert.equal(message.properties.deliveryMode, 2);
    b.channel.nack(message, false, false);
    let dead;
    for (let i = 0; i < 40 && !dead; i++) {
      dead = await b.channel.get(names.deadQueue, { noAck: false });
      if (!dead) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(dead, "Dead letter not delivered");
    b.channel.ack(dead);
  },
);
