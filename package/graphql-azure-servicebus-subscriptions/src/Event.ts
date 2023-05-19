import { ServiceBusReceivedMessage } from "@azure/service-bus";

export interface IEventBody {
    name: string;
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