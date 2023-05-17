import { PubSubEngine } from 'graphql-subscriptions';

import {
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusSender,
  delay,
  isServiceBusError,
} from '@azure/service-bus';

import { Subject, Subscription, filter, tap, map } from 'rxjs';
import debug from 'debug';

export interface IEventBody {
  name: string
  payload?: {
      [key: string]: any;
  };
}

export interface IEvent {
  /**
   * The message body that needs to be sent or is received.
   */
  body: IEventBody;
  /**
   * The application specific properties.
   */
  applicationProperties?: {
    [key: string]: number | boolean | string | Date | null;
  };
}

export interface IEventResult extends ServiceBusReceivedMessage, IEvent {
  body: IEventBody;
}

/**
 * Represents configuration needed to wire up PubSub engine with the ServiceBus topic
 * @property {string} connectionString - The ServiceBus connection string. This would be the Shared Access Policy connection string.
 * @property {string} topicName - This would be the topic where all the events will be published.
 * @property {string} subscriptionName - This would be the ServiceBus topic subscription name.
 */
export interface IServiceBusOptions {
  connectionString: string;
  topicName: string;
  subscriptionName: string;
}

/**
 * An override for the in-memory PubSubEngine which connects to the Azure ServiceBus.
 */

export class ServiceBusPubSub extends PubSubEngine {

  private client: ServiceBusClient;
  private sender: ServiceBusSender;
  private subscriptions = new Map<number, Subscription>();
  private options: IServiceBusOptions;
  private subject: Subject<IEventResult>;
  private debugger = debug("graphql:servicebus");
  private eventNameKey: string = "sub.eventName";
  private subscription : { close(): Promise<void> } = {close: () => { return Promise.resolve(); }};

  constructor(options: IServiceBusOptions, client?: ServiceBusClient) {
    super();
    this.options = options;
    this.client = client || new ServiceBusClient(this.options.connectionString);

    this.sender = this.client.createSender(this.options.topicName);
    
    this.subject = new Subject<IEventResult>();
    this.subscription = this.client
      .createReceiver(this.options.topicName, this.options.subscriptionName)
      .subscribe({
        processMessage: async (message: ServiceBusReceivedMessage) => {
          this.subject.next({
            ...message,
          });
        },
        processError: async (args) => {
          this.debugger(
            `Error from source ${args.errorSource} occurred: `,
            args.error
          );

          if (isServiceBusError(args.error)) {
            switch (args.error.code) {
              case 'MessagingEntityDisabled':
              case 'MessagingEntityNotFound':
              case 'UnauthorizedAccess':
                this.debugger(
                  `An unrecoverable error occurred. Stopping processing. ${args.error.code}`,
                  args.error
                );
                await this.subscription.close();
                break;
              case 'MessageLockLost':
                this.debugger(`Message lock lost for message`, args.error);
                break;
              case 'ServiceBusy':
                await delay(1000);
                break;
            }
          }
        } 
      });
  }
  
  async publish(eventName: string, payload: any): Promise<void> {
    try {
      let event: IEvent = {
        body: {
          name: eventName,
          payload: payload
        },
      };
    
      event  = this.enrichMessage( new Map<string, any>([[this.eventNameKey, eventName]]), event);
       return this.sender.sendMessages(event);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Subscribe to a specific event updates. The subscribe method would create a ServiceBusReceiver to listen to all the published events.
   * The method internally would filter out all the received events that are not meant for this subscriber.
   * @property {eventName | string} - published event name
   * @property {onMessage | Function} - client handler for processing received events.
   * @returns {Promise<number>} - returns the created identifier for the created subscription. It would be used to dispose/close any resources while unsubscribing.
   */
  async subscribe(eventName: string, onMessage: Function, options: Object = {}): Promise<number> {
    const id = Date.now() * Math.random();
    this.debugger("sub metadata: ", eventName, onMessage, options);
    this.subscriptions.set(
      id,
      this.subject.pipe(
          filter((e) => (eventName && e.body.name === eventName) || !eventName || eventName === '*'),
          map((e) => e.body.payload),
          tap((e) => e)
        )
        .subscribe((event) => {
          this.debugger("returned event: ", event);
          onMessage(event) }
          )
    );
    return id;
  }

  /**
   * Unsubscribe method would close open connection with the ServiceBus for a specific event handler.
   * @property {subId} - It's a unique identifier for each subscribed client.
   */
  async unsubscribe(subId: number) : Promise<boolean> {
    const subscription = this.subscriptions.get(subId) || undefined;
    if (!subscription) return false;
    if(!subscription.closed) {
      subscription.unsubscribe(); 
      this.subscriptions.delete(subId);
      return true;
    }
    return true;
  }


  async closeConnection() {
    return this.subscription.close();
  }

  private enrichMessage(
    attributes: Map<string, any>,
    message: ServiceBusMessage
  ) : ServiceBusMessage  {
    const enrichedMessage = Object.assign({}, message);

    if (enrichedMessage.applicationProperties == undefined)
    enrichedMessage.applicationProperties = {};

    attributes.forEach((value, key) => {
      if (
        enrichedMessage.applicationProperties !== undefined &&
        enrichedMessage.applicationProperties?.[key] === undefined
      ) {
        enrichedMessage.applicationProperties[key] = value;
      }
    });

    return enrichedMessage;
  }
}
