import  { ServiceBusPubSub, IServiceBusOptions }  from "@talema/graphql-azure-servicebus-subscriptions";
import { withFilter } from "graphql-subscriptions";
import dotenv from "dotenv";

dotenv.config();

const options: IServiceBusOptions = {
  connectionString: process.env.SERVICEBUS_CONNECTION_STRING!,
  topicName: process.env.SERVICEBUS_TOPIC!,
  subscriptionName: process.env.SERVICEBUS_SUBSCRIPTION_NAME!
}

export const  serviceBusPubSub = new ServiceBusPubSub(options);

export const resolvers = {
  Query: {
    async hello() {
        await serviceBusPubSub.publish("ConfigUpdate1", {configChanged: {Update: "Hello I'm a message", userId: "1234" }});
        await serviceBusPubSub.publish("ConfigUpdate2", {configChanged: {Update: "Hello I'm a message2", userId: "1235"}});
        await serviceBusPubSub.publish("ConfigUpdate1", {configChanged: {Update: "Hello I'm a message2", userId: "1236"}});
      return "Some message";
    },
  },
  Subscription: {
    configChanged: {
      subscribe: withFilter ( 
         () => serviceBusPubSub.asyncIterator("ConfigUpdate1"),  (payload, variables) => {
          return variables.userId === payload.configChanged.userId;
        }
      ),
    }
  },
};