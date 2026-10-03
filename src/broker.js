import amqp from "amqplib";
export const names = {
  exchange: "manabinder.jobs",
  queue: "manabinder.account-mail",
  deadExchange: "manabinder.dead",
  deadQueue: "manabinder.dead.account-mail",
};
export async function broker(url) {
  const connection = await amqp.connect(url, { timeout: 5000 });
  // Callers own reconnect/backoff; prevent EventEmitter errors becoming uncaught exceptions.
  connection.on("error", () => {});
  try {
    const channel = await connection.createConfirmChannel();
    channel.on("error", () => {});
    await channel.assertExchange(names.exchange, "direct", { durable: true });
    await channel.assertExchange(names.deadExchange, "direct", {
      durable: true,
    });
    await channel.assertQueue(names.deadQueue, {
      durable: true,
      arguments: { "x-queue-type": "quorum" },
    });
    await channel.bindQueue(
      names.deadQueue,
      names.deadExchange,
      "account.mail",
    );
    await channel.assertQueue(names.queue, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": names.deadExchange,
        "x-dead-letter-routing-key": "account.mail",
        "x-delivery-limit": 10,
        "x-dead-letter-strategy": "at-least-once",
        "x-overflow": "reject-publish",
        "x-max-length": 100000,
      },
    });
    await channel.bindQueue(names.queue, names.exchange, "account.mail");
    let returned = new Set();
    channel.on("return", (msg) => returned.add(msg.properties.messageId));
    return {
      connection,
      channel,
      async publish(message) {
        const messageId = String(message.eventId);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error("Publisher confirm timeout")),
            10000,
          );
          channel.publish(
            names.exchange,
            "account.mail",
            Buffer.from(JSON.stringify(message)),
            {
              persistent: true,
              mandatory: true,
              contentType: "application/json",
              messageId,
              correlationId: message.correlationId,
            },
            (error) => {
              clearTimeout(timeout);
              if (error || returned.delete(messageId))
                reject(error || Error("Unroutable job"));
              else resolve();
            },
          );
        });
      },
      async close() {
        await channel.close().catch(() => {});
        await connection.close().catch(() => {});
      },
    };
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
}
