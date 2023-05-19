import { Subject, delay } from "rxjs";
import { IEventResult } from "./Event";
import {
  ProcessErrorArgs,
  ServiceBusError,
  ServiceBusErrorCode,
  ServiceBusReceivedMessage,
  isServiceBusError,
} from "@azure/service-bus";
import { ILogger } from "./ServiceBusPubSub";
import { error } from "console";

export interface IMessageProcessor {
  /**
   *
   * @param subStream Rxjs channel based stream, each channel/client would have it's own stream pipeline.
   * @param message ServiceBusReceivedMessage
   */
  process(
    subStream: Subject<IEventResult>,
    message: ServiceBusReceivedMessage
  ): Promise<void>;

  /**
   *
   * @param args ServiceBus ProcessErrorArgs
   *
   */
  onError(
    args: ProcessErrorArgs,
    handleError: (error: ServiceBusError) => Promise<void>
  ): Promise<void>;
}

export class MessageProcessor implements IMessageProcessor {
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  async process(
    subject: Subject<IEventResult>,
    message: ServiceBusReceivedMessage
  ): Promise<void> {
    await subject.next({ ...message });
  }

  async onError(
    args: ProcessErrorArgs,
    handleError: (error: ServiceBusError) => Promise<void>
  ): Promise<void> {
    this.logger.error(
      `Error from source ${args.errorSource} occurred: `,
      args.error
    );

    if (isServiceBusError(args.error)) {
      switch (args.error.code) {
        case "MessagingEntityDisabled":
        case "MessagingEntityNotFound":
        case "UnauthorizedAccess":
          this.logger.error(
            `An unrecoverable error occurred. Stopping processing. ${args.error.code}`,
            args.error
          );
          await handleError(args.error);
          break;
        case "MessageLockLost":
          this.logger.error(`Message lock lost for message`, args.error);
          handleError(args.error);
          break;
        case "ServiceBusy":
          await delay(1000);
          handleError(args.error);
          break;
      }
    }
  }
}
