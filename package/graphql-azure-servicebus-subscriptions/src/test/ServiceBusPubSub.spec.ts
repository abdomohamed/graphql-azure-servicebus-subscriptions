// tslint:disable-next-line:no-empty

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";
import {IServiceBusOptions, ServiceBusPubSub } from "../ServiceBusPubSub";
import Simple, { Stub } from "simple-mock";
import {
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceiver,
  ServiceBusSender,
  ProcessErrorArgs
} from "@azure/service-bus";
import { FakeMessageSender, FakeMessageReceiver } from "./utils";
import { IMessageProcessor, MessageProcessor } from "../MessageProcessor";

chai.use(chaiAsPromised);
chai.use(sinonChai);

const expect = chai.expect;
const options: IServiceBusOptions = {
  topicName: "topic",
  subscriptionName: "subs-name",
  connectionString: "Endpoint=sb://a;SharedAccessKeyName=b;SharedAccessKey=c;"
};

const fakeReceiver = new FakeMessageReceiver();
const fakeSender = new FakeMessageSender(fakeReceiver);
const data: { message: any; eventName: string } = {
  eventName: "somethingChange",
  message: {data: "Hello"},
};

let mesageProcessor: IMessageProcessor = new MessageProcessor(console);
let {client, receiverMock, senderMock} = getMockedServiceBusClient(fakeSender, fakeReceiver);
let sut = new ServiceBusPubSub(options, console, mesageProcessor, client);


function getMockedServiceBusClient(
  senderSpy: any,
  fakeReceiver: any
): {
  client: ServiceBusClient;
  receiverMock: Stub<ServiceBusReceiver>;
  senderMock: Stub<ServiceBusSender>;
} {
  const client = new ServiceBusClient(
    options.connectionString
  );

  const senderMock = Simple.mock<ServiceBusClient>(
    client,
    "createSender"
  ).returnWith(senderSpy);

  const receiverMock = Simple.mock<ServiceBusClient>(
    client,
    "createReceiver"
  ).returnWith(fakeReceiver);

  return { client, senderMock, receiverMock };
}

describe("ServiceBusPubSub", () => {
  beforeEach("Reset state", () => {
    fakeReceiver.reset();
    fakeSender.reset();
  });

  it("can subscribe and is called when events happen", async () => {
    let subscribeCalled = false;
    let receivedMessage = undefined;

    await sut.subscribe(data.eventName, async (payload: any) => {
      subscribeCalled = true;
      receivedMessage = payload;
    }, {});

    await sut.publish(data.eventName, data.message);
    expect(fakeReceiver.pendingMessages.length).to.equal(1);

    await fakeReceiver.flush();
    expect(subscribeCalled).to.be.true;
    expect(receivedMessage).to.equal(data.message);
  });

  it("Can ignore events not specified in the subscription", async () => {
    let subscribeCalled = false;
    let receivedMessage = undefined;

    await sut.subscribe("unknownEvent", async (payload: any) => {
      subscribeCalled = true;
      receivedMessage = payload;
    }, {});

    await sut.publish(data.eventName, data.message);
    await fakeReceiver.flush();

    expect(subscribeCalled).to.be.false;
    expect(receivedMessage).to.equal(undefined);
  });

  it("will add eventName as an attribute to the ServiceBusMessage published", async () => {
    await sut.subscribe(data.eventName, () => {}, {});
    await sut.publish(data.eventName, data.message);
    const values: Array<any> = [];

    for (const key in fakeReceiver.pendingMessages[0].applicationProperties) {
      values.push(fakeReceiver.pendingMessages[0].applicationProperties[key]);
    }

    expect(values).to.have.members([data.eventName]);
  });

  it("will subscribe once to the save event", async () => {
    await sut.subscribe(data.eventName, () => {}, {});
    await sut.subscribe(data.eventName, () => {}, {});
    expect(receiverMock.callCount).to.eq(1);
  });

  it("will create publisher for the eventName once", async () => {
    await sut.publish(data.eventName, data.message);
    await sut.publish(data.eventName, data.message);
    expect(senderMock.callCount).to.eq(1);
  });

  it("will enrich the published ServiceBusMessage with the label", async () => {
    const message: ServiceBusMessage = {
      body: "test message",
      applicationProperties: {},
    };

    await sut.publish(data.eventName, message);
    const publishedMessage = fakeSender.lastMessage();
    expect(publishedMessage?.applicationProperties).to.deep.equal({
      "sub.eventName": data.eventName,
    });
  });

  it("can unsubscribe if passed the right client identifier", async () => {
    const clientId = await sut.subscribe("a", (_: any) => {});
    expect(await sut.unsubscribe(clientId)).to.be.true;
  });

  it("will skip unsubscribe for unknown client identifiers", async () => {
    await sut.subscribe("a", (_: any) => {});
    let clientClosed: boolean = false;

    fakeReceiver.onClose = () => {
      clientClosed = true;
    };
    await sut.unsubscribe(55);
    expect(clientClosed).to.be.false;
  });

  it("unsubscripe last client will close servicebus connection", async () => {
    sut = new ServiceBusPubSub(options, console, mesageProcessor, client);

    var subIdOne = await sut.subscribe("a", (_: any) => {});
    var subIdTwo = await sut.subscribe("a", (_: any) => {});

    let clientClosed: boolean = false;

    fakeReceiver.onClose = () => { clientClosed = true; };
    await sut.unsubscribe(subIdOne);
    expect(clientClosed).to.be.false;

    await sut.unsubscribe(subIdTwo);
    expect(clientClosed).to.be.true;
  });

  it("processError handler is called when the subscription recieve error", async () => {
    let errorsResult: {[key: string]: any;} = {
      "UnauthorizedAccess" : false,
      "MessageLockLost": false,
      "ServiceBusy": false
    };

    var errors = Object.keys(errorsResult);
    errors.forEach(async (errorCode:string) => {
      await mesageProcessor.onError(<ProcessErrorArgs> {error: {code: errorCode, name: "ServiceBusError"}}, async (error): Promise<void> => {
        errorsResult[errorCode] = true;
        return Promise.resolve();
      });
      expect( errorsResult[errorCode]).to.be.true;
    });
  });
});